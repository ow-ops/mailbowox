//! Opaque per-id blobs. The server stores ciphertext and a hash of the auth secret.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::header::{ETAG, IF_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use headers::authorization::Bearer;
use headers::{Authorization, HeaderMapExt};
use sha2::{Digest, Sha256};
use sqlx::AnyPool;
use subtle::ConstantTimeEq;
use tracing::error;

use crate::AppState;
use crate::db::unix_now;

pub const MAX_BLOB_BYTES: usize = 1 << 20;
/// Bounds what the vaults can take on disk, at `MAX_BLOB_BYTES` each. Deleted ones count.
const MAX_VAULTS: i64 = 100_000;
const REPLACE_BLOB: &str = "UPDATE vault SET blob = $1, version = version + 1
                            WHERE id = $2 AND version = $3 AND deleted_at IS NULL";

pub struct Store {
    db: AnyPool,
    max_vaults: i64,
}

/// A vault's auth digest, version, blob and deletion time.
type Row = (Vec<u8>, i64, Vec<u8>, Option<i64>);

/// The auth digest, version and deletion time of a vault.
type Meta = (Vec<u8>, i64, Option<i64>);

enum Outcome {
    Missing,
    Forbidden,
    /// The owner deleted the vault.
    Gone,
    Deleted,
    Full,
    Conflict(i64),
    Found(Vec<u8>, i64),
    Stored(i64, bool),
}

impl Store {
    pub fn new(db: AnyPool) -> Self {
        Self {
            db,
            max_vaults: MAX_VAULTS,
        }
    }

    async fn get(&self, id: &str, auth: &[u8; 32]) -> Result<Outcome, sqlx::Error> {
        let row: Option<Row> = sqlx::query_as(
            "SELECT auth_sha256, version, blob, deleted_at FROM vault WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.db)
        .await?;
        Ok(match row {
            None => Outcome::Missing,
            Some((stored, ..)) if !auth_matches(&stored, auth) => Outcome::Forbidden,
            Some((.., Some(_))) => Outcome::Gone,
            Some((_, version, blob, None)) => Outcome::Found(blob, version),
        })
    }

    /// Empties the vault and marks it deleted. The row stays, so devices still holding the key
    /// are told it is gone rather than finding nothing and creating it again.
    async fn delete(&self, id: &str, auth: &[u8; 32], now: i64) -> Result<Outcome, sqlx::Error> {
        let Some((stored, ..)) = self.meta(id).await? else {
            return Ok(Outcome::Missing);
        };
        if !auth_matches(&stored, auth) {
            return Ok(Outcome::Forbidden);
        }
        sqlx::query(
            "UPDATE vault SET blob = $1, deleted_at = COALESCE(deleted_at, $2) WHERE id = $3",
        )
        .bind(Vec::<u8>::new())
        .bind(now)
        .bind(id)
        .execute(&self.db)
        .await?;
        Ok(Outcome::Deleted)
    }

    async fn put(
        &self,
        id: &str,
        auth: &[u8; 32],
        if_match: i64,
        body: &[u8],
    ) -> Result<Outcome, sqlx::Error> {
        let current = self.meta(id).await?;
        if let Some((stored, ..)) = &current
            && !auth_matches(stored, auth)
        {
            return Ok(Outcome::Forbidden);
        }
        if matches!(current, Some((.., Some(_)))) {
            return Ok(Outcome::Gone);
        }
        let version = current.as_ref().map_or(0, |(_, version, _)| *version);
        if if_match != version {
            return Ok(Outcome::Conflict(version));
        }
        if version == 0 {
            let (vaults,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM vault")
                .fetch_one(&self.db)
                .await?;
            if vaults >= self.max_vaults {
                return Ok(Outcome::Full);
            }
        }
        // The version in the WHERE clause and the primary key make the write conditional, so of
        // two writers racing from the same version only one lands.
        let written = if version == 0 {
            sqlx::query(
                "INSERT INTO vault (id, auth_sha256, version, blob) VALUES ($1, $2, 1, $3)
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(id)
            .bind(auth.as_slice())
            .bind(body)
            .execute(&self.db)
            .await?
        } else {
            sqlx::query(REPLACE_BLOB)
                .bind(body)
                .bind(id)
                .bind(version)
                .execute(&self.db)
                .await?
        };
        if written.rows_affected() == 0 {
            return Ok(match self.meta(id).await? {
                Some((stored, ..)) if !auth_matches(&stored, auth) => Outcome::Forbidden,
                Some((.., Some(_))) => Outcome::Gone,
                Some((_, version, None)) => Outcome::Conflict(version),
                None => Outcome::Conflict(0),
            });
        }
        Ok(Outcome::Stored(version + 1, version == 0))
    }

    async fn meta(&self, id: &str) -> Result<Option<Meta>, sqlx::Error> {
        sqlx::query_as("SELECT auth_sha256, version, deleted_at FROM vault WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.db)
            .await
    }
}

fn auth_matches(stored: &[u8], auth: &[u8; 32]) -> bool {
    bool::from(stored.ct_eq(auth))
}

fn etag(version: i64) -> HeaderValue {
    HeaderValue::from_str(&format!("\"{version}\"")).expect("a quoted integer is a header value")
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub fn bearer(headers: &HeaderMap) -> Option<[u8; 32]> {
    let Authorization(bearer) = headers.typed_get::<Authorization<Bearer>>()?;
    Some(Sha256::digest(bearer.token().as_bytes()).into())
}

fn parse_if_match(headers: &HeaderMap) -> Option<i64> {
    let Some(value) = headers.get(IF_MATCH) else {
        return Some(0);
    };
    value.to_str().ok()?.trim().trim_matches('"').parse().ok()
}

fn with_etag(status: StatusCode, version: i64, body: Vec<u8>) -> Response {
    (status, [(ETAG, etag(version))], body).into_response()
}

fn respond(outcome: Result<Outcome, sqlx::Error>) -> Response {
    match outcome {
        Ok(Outcome::Missing) => StatusCode::NOT_FOUND.into_response(),
        Ok(Outcome::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Ok(Outcome::Gone) => StatusCode::GONE.into_response(),
        Ok(Outcome::Deleted) => StatusCode::NO_CONTENT.into_response(),
        Ok(Outcome::Full) => StatusCode::INSUFFICIENT_STORAGE.into_response(),
        Ok(Outcome::Conflict(version)) => {
            with_etag(StatusCode::PRECONDITION_FAILED, version, Vec::new())
        }
        Ok(Outcome::Found(blob, version)) => with_etag(StatusCode::OK, version, blob),
        Ok(Outcome::Stored(version, created)) => {
            let status = if created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            with_etag(status, version, Vec::new())
        }
        Err(error) => {
            error!(%error, "vault storage failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !valid_id(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(auth) = bearer(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    respond(state.vault.get(&id, &auth).await)
}

pub async fn put(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !valid_id(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(auth) = bearer(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Some(if_match) = parse_if_match(&headers) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    respond(state.vault.put(&id, &auth, if_match, &body).await)
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !valid_id(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(auth) = bearer(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    respond(state.vault.delete(&id, &auth, unix_now()).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    #[tokio::test]
    async fn a_write_that_saw_the_previous_version_cannot_refill_a_deleted_vault() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db.clone());
        let auth = [1; 32];
        store.put("a", &auth, 0, b"old").await.unwrap();
        let (_, version, _) = store.meta("a").await.unwrap().unwrap();
        store.delete("a", &auth, 1).await.unwrap();

        let result = sqlx::query(REPLACE_BLOB)
            .bind(b"new".as_slice())
            .bind("a")
            .bind(version)
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(result.rows_affected(), 0);
        let (blob,): (Vec<u8>,) = sqlx::query_as("SELECT blob FROM vault WHERE id = 'a'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(blob, [] as [u8; 0]);
        assert!(matches!(
            store.put("a", &auth, version, b"new").await.unwrap(),
            Outcome::Gone
        ));
    }

    #[tokio::test]
    async fn no_vault_is_created_past_the_cap_and_existing_ones_still_take_writes() {
        let (db, _dir) = test_pool().await;
        let store = Store { db, max_vaults: 1 };
        let auth = [1; 32];
        assert!(matches!(
            store.put("a", &auth, 0, b"one").await.unwrap(),
            Outcome::Stored(1, true)
        ));
        assert!(matches!(
            store.put("b", &auth, 0, b"one").await.unwrap(),
            Outcome::Full
        ));
        assert!(matches!(
            store.put("a", &auth, 1, b"two").await.unwrap(),
            Outcome::Stored(2, false)
        ));
    }
}
