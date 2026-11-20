//! One-shot rendezvous for device linking: a message is stored once, read once, and expires.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sqlx::AnyPool;
use tracing::error;

use crate::AppState;
use crate::db::unix_now;
use crate::vault::valid_id;

pub const MAX_MESSAGE_BYTES: usize = 4096;
const TTL_SECS: i64 = 120;
const MAX_MESSAGES: i64 = 4096;
/// A link takes two messages, one from each device, and both are often behind one address: this
/// leaves room for ten attempts in the two minutes a message waits.
pub const MAX_WAITING_PER_CLIENT: i64 = 20;

pub struct Store {
    db: AnyPool,
}

impl Store {
    pub fn new(db: AnyPool) -> Self {
        Self { db }
    }

    async fn put(&self, id: &str, body: &[u8], now: i64) -> Result<StatusCode, sqlx::Error> {
        sqlx::query("DELETE FROM link WHERE expires_at <= $1")
            .bind(now)
            .execute(&self.db)
            .await?;
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM link")
            .fetch_one(&self.db)
            .await?;
        if count >= MAX_MESSAGES {
            return Ok(StatusCode::SERVICE_UNAVAILABLE);
        }
        let inserted = sqlx::query(
            "INSERT INTO link (id, body, expires_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(body)
        .bind(now + TTL_SECS)
        .execute(&self.db)
        .await?;
        Ok(if inserted.rows_affected() == 0 {
            StatusCode::CONFLICT
        } else {
            StatusCode::CREATED
        })
    }

    async fn take(&self, id: &str, now: i64) -> Result<Option<Vec<u8>>, sqlx::Error> {
        let row: Option<(Vec<u8>, i64)> =
            sqlx::query_as("DELETE FROM link WHERE id = $1 RETURNING body, expires_at")
                .bind(id)
                .fetch_optional(&self.db)
                .await?;
        Ok(row.and_then(|(body, expires_at)| (expires_at > now).then_some(body)))
    }
}

fn failed(error: &sqlx::Error) -> Response {
    error!(%error, "link storage failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

pub async fn post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !valid_id(&id) || body.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match state.links.put(&id, &body, unix_now()).await {
        Ok(status) => status.into_response(),
        Err(error) => failed(&error),
    }
}

pub async fn get(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    if !valid_id(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match state.links.take(&id, unix_now()).await {
        Ok(Some(body)) => body.into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => failed(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    #[tokio::test]
    async fn a_message_expires_after_two_minutes() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db);
        let id = "ab".repeat(32);
        assert_eq!(
            store.put(&id, b"key", 1000).await.unwrap(),
            StatusCode::CREATED
        );
        assert_eq!(
            store.take(&id, 1119).await.unwrap().as_deref(),
            Some(&b"key"[..])
        );

        store.put(&id, b"key", 1000).await.unwrap();
        assert_eq!(store.take(&id, 1121).await.unwrap(), None);

        store.put(&id, b"key", 2000).await.unwrap();
        // The expired message no longer blocks the id.
        assert_eq!(
            store.put(&id, b"again", 2121).await.unwrap(),
            StatusCode::CREATED
        );
    }
}
