//! Registrations are sealed with the server key; the id is associated data, so a row copied under
//! another id won't open. Workers hold rows through leases: each renews its own and claims lapsed
//! ones, so a crashed worker's inboxes move to the others.
//!
//! Keys are a keyring. Rows are sealed under the current key and name it, so older keys still
//! open old rows. A worker claiming a row sealed under an older key reseals it under the current
//! one.

use sqlx::AnyPool;
use subtle::ConstantTimeEq;
use tracing::{info, warn};

use super::Registration;
use super::key::Key;
use super::watcher::Seen;

/// Bounds the table, whatever the device tokens registered are worth.
const MAX_REGISTRATIONS: i64 = 1_000_000;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// A claimed row: id, sealed registration, key id, UID validity and next UID.
type Claimed = (String, Vec<u8>, String, Option<i64>, Option<i64>);

pub enum Removal {
    Removed,
    Missing,
    Forbidden,
}

pub struct Store {
    db: AnyPool,
    current: Key,
    old: Vec<Key>,
    max_registrations: i64,
}

impl Store {
    pub fn new(db: AnyPool, current: &[u8; 32], old: &[[u8; 32]]) -> Self {
        let current = Key::new(current);
        let old = old
            .iter()
            .map(Key::new)
            .filter(|key| key.id != current.id)
            .collect();
        Self {
            db,
            current,
            old,
            max_registrations: MAX_REGISTRATIONS,
        }
    }

    /// Whether the gateway holds as many registrations as it takes.
    pub async fn full(&self) -> Result<bool, sqlx::Error> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM push_registration")
            .fetch_one(&self.db)
            .await?;
        Ok(count >= self.max_registrations)
    }

    fn keys(&self) -> impl Iterator<Item = &Key> {
        std::iter::once(&self.current).chain(&self.old)
    }

    /// Hashes of `parts` under every key, since rows still sealed under an older key were
    /// indexed with it.
    fn indexes(&self, parts: &[&[u8]]) -> Vec<String> {
        self.keys().map(|key| key.index(parts)).collect()
    }

    /// Stores the registration in place of any earlier one for the same account and device, with
    /// the digest of the secret that later removes it. `None` when the device already has
    /// `max_per_device` other accounts.
    pub async fn add(
        &self,
        registration: &Registration,
        secret_sha256: &[u8; 32],
        max_per_device: usize,
        seen: Option<Seen>,
    ) -> Result<Option<String>, Error> {
        let token = registration.token.as_bytes();
        let email = registration.email.to_lowercase();
        let devices = self.indexes(&[b"device", token]);
        let accounts = self.indexes(&[b"account", token, email.as_bytes()]);
        let id = new_id()?;
        let sealed = self.current.seal(&id, registration)?;

        let mut tx = self.db.begin().await?;
        let mut delete = sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM push_registration WHERE account IN ({})",
            placeholders(accounts.len())
        )));
        for account in &accounts {
            delete = delete.bind(account);
        }
        delete.execute(&mut *tx).await?;
        let mut count = sqlx::query_as::<_, (i64,)>(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM push_registration WHERE device IN ({})",
            placeholders(devices.len())
        )));
        for device in &devices {
            count = count.bind(device);
        }
        let (count,) = count.fetch_one(&mut *tx).await?;
        if usize::try_from(count).unwrap_or(usize::MAX) >= max_per_device {
            return Ok(None);
        }
        sqlx::query(
            "INSERT INTO push_registration
                 (id, device, account, sealed, secret_sha256, key_id, uid_validity, uid_next)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(&id)
        .bind(&devices[0])
        .bind(&accounts[0])
        .bind(sealed)
        .bind(secret_sha256.as_slice())
        .bind(&self.current.id)
        .bind(seen.map(|seen| i64::from(seen.uid_validity)))
        .bind(seen.map(|seen| i64::from(seen.uid_next)))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(id))
    }

    /// Deletes the registration when `secret_sha256` is the one it was stored with.
    pub async fn remove(&self, id: &str, secret_sha256: &[u8; 32]) -> Result<Removal, sqlx::Error> {
        let row: Option<(Vec<u8>,)> =
            sqlx::query_as("SELECT secret_sha256 FROM push_registration WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.db)
                .await?;
        let Some((stored,)) = row else {
            return Ok(Removal::Missing);
        };
        if !bool::from(stored.ct_eq(secret_sha256)) {
            return Ok(Removal::Forbidden);
        }
        let removed = sqlx::query("DELETE FROM push_registration WHERE id = $1")
            .bind(id)
            .execute(&self.db)
            .await?;
        Ok(if removed.rows_affected() > 0 {
            Removal::Removed
        } else {
            Removal::Missing
        })
    }

    /// Drops a registration whose watcher gave up, unless another worker took it meanwhile.
    pub async fn remove_owned(&self, id: &str, owner: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM push_registration WHERE id = $1 AND owner = $2")
            .bind(id)
            .bind(owner)
            .execute(&self.db)
            .await?;
        Ok(())
    }

    /// Extends the owner's leases and returns the ids it still holds.
    pub async fn renew(&self, owner: &str, until: i64) -> Result<Vec<String>, sqlx::Error> {
        let ids: Vec<(String,)> = sqlx::query_as(
            "UPDATE push_registration SET lease_until = $1 WHERE owner = $2 RETURNING id",
        )
        .bind(until)
        .bind(owner)
        .fetch_all(&self.db)
        .await?;
        Ok(ids.into_iter().map(|(id,)| id).collect())
    }

    /// Records where the inbox of a registration stood, while `owner` still holds it.
    pub async fn saw(&self, id: &str, owner: &str, seen: Seen) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE push_registration SET uid_validity = $1, uid_next = $2
             WHERE id = $3 AND owner = $4",
        )
        .bind(i64::from(seen.uid_validity))
        .bind(i64::from(seen.uid_next))
        .bind(id)
        .bind(owner)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Takes up to `limit` registrations nobody holds, each with where its inbox last stood.
    /// Those that do not open with any key are logged and given up: their lease runs out
    /// unrenewed, so a worker that has the key can take them.
    pub async fn claim(
        &self,
        owner: &str,
        now: i64,
        until: i64,
        limit: usize,
    ) -> Result<Vec<(String, Registration, Option<Seen>)>, sqlx::Error> {
        // The lapse is checked again outside the subquery: a worker that waited on a row
        // another one just claimed sees the new lease and skips it.
        let rows: Vec<Claimed> = sqlx::query_as(
            "UPDATE push_registration SET owner = $1, lease_until = $2
             WHERE lease_until <= $3 AND id IN (
                 SELECT id FROM push_registration WHERE lease_until <= $3 LIMIT $4
             )
             RETURNING id, sealed, key_id, uid_validity, uid_next",
        )
        .bind(owner)
        .bind(until)
        .bind(now)
        .bind(i64::try_from(limit).unwrap_or(i64::MAX))
        .fetch_all(&self.db)
        .await?;
        let mut claimed = Vec::with_capacity(rows.len());
        let mut resealed = 0;
        for (id, sealed, key_id, uid_validity, uid_next) in rows {
            let Some(registration) = self.open(&id, &sealed, &key_id) else {
                warn!(
                    id,
                    "push registration does not open with any push secret key"
                );
                sqlx::query(
                    "UPDATE push_registration SET owner = NULL WHERE id = $1 AND owner = $2",
                )
                .bind(&id)
                .bind(owner)
                .execute(&self.db)
                .await?;
                continue;
            };
            let seen = uid_validity.zip(uid_next).and_then(|(validity, next)| {
                Some(Seen {
                    uid_validity: u32::try_from(validity).ok()?,
                    uid_next: u32::try_from(next).ok()?,
                })
            });
            if key_id != self.current.id {
                match self.reseal(&id, owner, &registration).await {
                    Ok(()) => resealed += 1,
                    Err(error) => warn!(%error, id, "could not seal the push registration again"),
                }
            }
            claimed.push((id, registration, seen));
        }
        if resealed > 0 {
            info!(
                count = resealed,
                "push registrations sealed again under the current key"
            );
        }
        Ok(claimed)
    }

    fn open(&self, id: &str, bytes: &[u8], key_id: &str) -> Option<Registration> {
        self.keys()
            .filter(|key| key.id == key_id)
            .find_map(|key| key.open(id, bytes))
    }

    async fn reseal(
        &self,
        id: &str,
        owner: &str,
        registration: &Registration,
    ) -> Result<(), Error> {
        let token = registration.token.as_bytes();
        let email = registration.email.to_lowercase();
        sqlx::query(
            "UPDATE push_registration SET sealed = $1, key_id = $2, device = $3, account = $4
             WHERE id = $5 AND owner = $6",
        )
        .bind(self.current.seal(id, registration)?)
        .bind(&self.current.id)
        .bind(self.current.index(&[b"device", token]))
        .bind(self.current.index(&[b"account", token, email.as_bytes()]))
        .bind(id)
        .bind(owner)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Hands the owner's registrations back so another worker can take them at once.
    pub async fn release(&self, owner: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE push_registration SET owner = NULL, lease_until = 0 WHERE owner = $1")
            .bind(owner)
            .execute(&self.db)
            .await?;
        Ok(())
    }
}

/// `$1, $2, …` for `count` bound values.
fn placeholders(count: usize) -> String {
    (1..=count)
        .map(|n| format!("${n}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn random_hex<const N: usize>() -> Result<String, getrandom::Error> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes)?;
    Ok(hex::encode(bytes))
}

pub fn new_id() -> Result<String, getrandom::Error> {
    random_hex::<16>()
}

pub fn new_secret() -> Result<String, getrandom::Error> {
    random_hex::<32>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::push::{Platform, Security};

    const SECRET: [u8; 32] = [1; 32];

    fn registration(token: &str, user: &str) -> Registration {
        Registration {
            platform: Platform::Android,
            token: token.into(),
            email: format!("{user}@example.org"),
            host: "imap.example.org".into(),
            port: 993,
            security: Security::Tls,
            username: user.into(),
            password: "hunter2-secret".into(),
        }
    }

    async fn rows(db: &AnyPool) -> Vec<(String, String, String, Vec<u8>)> {
        sqlx::query_as("SELECT id, device, account, sealed FROM push_registration")
            .fetch_all(db)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn rows_name_nobody_and_open_only_with_the_key() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db.clone(), &[7; 32], &[]);
        let id = store
            .add(&registration("device-token", "alice"), &SECRET, 10, None)
            .await
            .unwrap()
            .unwrap();

        let row = format!("{:?}", rows(&db).await);
        for secret in ["hunter2", "alice", "device-token", "example.org"] {
            assert!(!row.contains(secret), "{secret} is stored in the clear");
        }

        let claimed = store.claim("a", 0, 60, 10).await.unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].0, id);
        assert_eq!(claimed[0].1.password, "hunter2-secret");

        let other = Store::new(db, &[8; 32], &[]);
        other.release("a").await.unwrap();
        assert!(other.claim("b", 0, 60, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_row_under_another_id_does_not_open() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db.clone(), &[7; 32], &[]);
        store
            .add(&registration("t", "alice"), &SECRET, 10, None)
            .await
            .unwrap();
        sqlx::query("UPDATE push_registration SET id = 'swapped'")
            .execute(&db)
            .await
            .unwrap();
        assert!(store.claim("a", 0, 60, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_account_replaces_itself_and_a_device_is_capped() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db.clone(), &[7; 32], &[]);
        let first = store
            .add(&registration("t1", "alice"), &SECRET, 1, None)
            .await
            .unwrap()
            .unwrap();
        let second = store
            .add(&registration("t1", "Alice"), &SECRET, 1, None)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            store.remove(&first, &SECRET).await.unwrap(),
            Removal::Missing
        ));

        assert_eq!(
            store
                .add(&registration("t1", "bob"), &SECRET, 1, None)
                .await
                .unwrap(),
            None
        );
        assert!(
            store
                .add(&registration("t2", "bob"), &SECRET, 1, None)
                .await
                .unwrap()
                .is_some()
        );
        assert!(matches!(
            store.remove(&second, &SECRET).await.unwrap(),
            Removal::Removed
        ));
        assert_eq!(rows(&db).await.len(), 1);
    }

    #[tokio::test]
    async fn a_lapsed_lease_moves_to_another_worker() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db, &[7; 32], &[]);
        let id = store
            .add(&registration("t", "alice"), &SECRET, 10, None)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(store.claim("a", 100, 160, 10).await.unwrap().len(), 1);
        assert!(store.claim("b", 130, 190, 10).await.unwrap().is_empty());
        assert_eq!(
            store.renew("a", 210).await.unwrap(),
            std::slice::from_ref(&id)
        );
        assert!(store.claim("b", 200, 260, 10).await.unwrap().is_empty());

        assert_eq!(store.claim("b", 211, 271, 10).await.unwrap().len(), 1);
        assert_eq!(store.renew("a", 270).await.unwrap(), Vec::<String>::new());
        store.remove_owned(&id, "a").await.unwrap();
        assert_eq!(store.renew("b", 280).await.unwrap(), [id]);
    }

    #[tokio::test]
    async fn released_leases_are_claimed_at_once_up_to_the_limit() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db, &[7; 32], &[]);
        for user in ["alice", "bob", "carol"] {
            store
                .add(&registration("t", user), &SECRET, 10, None)
                .await
                .unwrap();
        }
        assert_eq!(store.claim("a", 100, 160, 2).await.unwrap().len(), 2);
        assert_eq!(store.claim("b", 100, 160, 10).await.unwrap().len(), 1);
        store.release("a").await.unwrap();
        assert_eq!(store.claim("b", 101, 161, 10).await.unwrap().len(), 2);
        assert_eq!(store.renew("b", 170).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn racing_workers_never_share_a_registration() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db, &[7; 32], &[]);
        for n in 0..60 {
            store
                .add(&registration("t", &format!("user{n}")), &SECRET, 100, None)
                .await
                .unwrap();
        }
        let claims = ["a", "b", "c", "d"].map(|owner| store.claim(owner, 100, 160, 20));
        let mut ids: Vec<String> = futures_util::future::join_all(claims)
            .await
            .into_iter()
            .flat_map(|claimed| claimed.unwrap().into_iter().map(|(id, _, _)| id))
            .collect();
        let claimed = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), claimed);
        let rest = store.claim("e", 100, 160, 100).await.unwrap();
        assert_eq!(claimed + rest.len(), 60);
    }

    #[tokio::test]
    async fn only_the_registrations_own_secret_removes_it() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db, &[7; 32], &[]);
        let id = store
            .add(&registration("t", "alice"), &SECRET, 10, None)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            store.remove(&id, &[2; 32]).await.unwrap(),
            Removal::Forbidden
        ));
        assert!(matches!(
            store.remove("unknown", &SECRET).await.unwrap(),
            Removal::Missing
        ));
        assert!(matches!(
            store.remove(&id, &SECRET).await.unwrap(),
            Removal::Removed
        ));
    }

    #[tokio::test]
    async fn the_table_is_full_at_its_cap() {
        let (db, _dir) = test_pool().await;
        let mut store = Store::new(db, &[7; 32], &[]);
        store.max_registrations = 1;
        assert!(!store.full().await.unwrap());
        store
            .add(&registration("t", "alice"), &SECRET, 10, None)
            .await
            .unwrap();
        assert!(store.full().await.unwrap());
    }

    #[tokio::test]
    async fn where_the_inbox_stood_follows_the_registration_to_the_next_worker() {
        let (db, _dir) = test_pool().await;
        let store = Store::new(db, &[7; 32], &[]);
        let at_registration = Seen {
            uid_validity: 9,
            uid_next: 40,
        };
        let id = store
            .add(
                &registration("t", "alice"),
                &SECRET,
                10,
                Some(at_registration),
            )
            .await
            .unwrap()
            .unwrap();
        let claimed = store.claim("a", 0, 60, 10).await.unwrap();
        assert_eq!(claimed[0].2, Some(at_registration));

        let later = Seen {
            uid_validity: 9,
            uid_next: 42,
        };
        store.saw(&id, "a", later).await.unwrap();
        // A worker that lost the lease no longer writes.
        store.saw(&id, "b", at_registration).await.unwrap();
        store.release("a").await.unwrap();
        let claimed = store.claim("b", 0, 60, 10).await.unwrap();
        assert_eq!(claimed[0].2, Some(later));
    }

    #[tokio::test]
    async fn rows_sealed_under_an_old_key_open_and_move_to_the_current_one() {
        let (db, _dir) = test_pool().await;
        let old = Store::new(db.clone(), &[7; 32], &[]);
        let id = old
            .add(&registration("t", "alice"), &SECRET, 10, None)
            .await
            .unwrap()
            .unwrap();

        // A worker without the key gives the row up instead of holding its lease.
        let without_old_key = Store::new(db.clone(), &[8; 32], &[]);
        assert!(
            without_old_key
                .claim("a", 0, 60, 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            without_old_key.renew("a", 120).await.unwrap(),
            Vec::<String>::new()
        );
        without_old_key.release("a").await.unwrap();
        sqlx::query("UPDATE push_registration SET lease_until = 0")
            .execute(&db)
            .await
            .unwrap();

        let rotated = Store::new(db.clone(), &[8; 32], &[[7; 32]]);
        let claimed = rotated.claim("a", 0, 60, 10).await.unwrap();
        assert_eq!(claimed[0].1.password, "hunter2-secret");

        rotated.release("a").await.unwrap();
        let retired = without_old_key.claim("b", 0, 60, 10).await.unwrap();
        assert_eq!(retired[0].0, id);
        assert_eq!(retired[0].1.password, "hunter2-secret");
    }

    #[tokio::test]
    async fn an_account_replaces_itself_after_a_key_change() {
        let (db, _dir) = test_pool().await;
        let before = Store::new(db.clone(), &[7; 32], &[]);
        before
            .add(&registration("t", "alice"), &SECRET, 1, None)
            .await
            .unwrap();

        let after = Store::new(db.clone(), &[8; 32], &[[7; 32]]);
        after
            .add(&registration("t", "alice"), &SECRET, 1, None)
            .await
            .unwrap();
        assert_eq!(rows(&db).await.len(), 1);
        assert_eq!(
            after
                .add(&registration("t", "bob"), &SECRET, 1, None)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_row_leased_under_the_old_key_stays_with_its_worker_until_the_lease_lapses() {
        let (db, _dir) = test_pool().await;
        let old = Store::new(db.clone(), &[7; 32], &[]);
        let id = old
            .add(&registration("t", "alice"), &SECRET, 10, None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(old.claim("a", 100, 160, 10).await.unwrap().len(), 1);
        let key_id = async || -> String {
            sqlx::query_as::<_, (String,)>("SELECT key_id FROM push_registration")
                .fetch_one(&db)
                .await
                .unwrap()
                .0
        };

        let rotated = Store::new(db.clone(), &[8; 32], &[[7; 32]]);
        assert!(rotated.claim("b", 130, 190, 10).await.unwrap().is_empty());
        assert_eq!(
            old.renew("a", 220).await.unwrap(),
            std::slice::from_ref(&id)
        );
        assert_eq!(key_id().await, old.current.id);

        let claimed = rotated.claim("b", 221, 281, 10).await.unwrap();
        assert_eq!(claimed[0].0, id);
        assert_eq!(claimed[0].1.password, "hunter2-secret");
        assert_eq!(key_id().await, rotated.current.id);
        assert_eq!(old.renew("a", 280).await.unwrap(), Vec::<String>::new());
    }
}
