//! Gateway state lives in SQLite for a single process, or Postgres when several share it.

use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::AnyPool;
use sqlx::any::{AnyPoolOptions, install_default_drivers};
use sqlx::migrate::{MigrateError, Migrator};

static SQLITE: Migrator = sqlx::migrate!("migrations/sqlite");
static POSTGRES: Migrator = sqlx::migrate!("migrations/postgres");

/// Connects on first use, so a relay-only gateway never opens the database.
pub fn pool(url: &str) -> Result<AnyPool, sqlx::Error> {
    install_default_drivers();
    AnyPoolOptions::new().connect_lazy(url)
}

pub fn is_postgres(url: &str) -> bool {
    url.starts_with("postgres")
}

pub async fn migrate(pool: &AnyPool, url: &str) -> Result<(), MigrateError> {
    let migrator = if is_postgres(url) { &POSTGRES } else { &SQLITE };
    migrator.run(pool).await
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            i64::try_from(since.as_secs()).unwrap_or(i64::MAX)
        })
}

/// A fresh database per test: a schema of its own on `TEST_POSTGRES_URL` when set, SQLite
/// otherwise.
#[cfg(test)]
pub async fn test_pool() -> (AnyPool, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("temp dir");
    let url = match std::env::var("TEST_POSTGRES_URL") {
        Ok(base) => {
            let schema = format!("t{}", hex::encode(rand_bytes()));
            let admin = pool(&base).expect("postgres url");
            sqlx::query(sqlx::AssertSqlSafe(format!("CREATE SCHEMA {schema}")))
                .execute(&admin)
                .await
                .expect("create schema");
            let joiner = if base.contains('?') { '&' } else { '?' };
            format!("{base}{joiner}options=-csearch_path%3D{schema}")
        }
        Err(_) => format!("sqlite://{}/gateway.db?mode=rwc", dir.path().display()),
    };
    let pool = pool(&url).expect("database url");
    migrate(&pool, &url).await.expect("migrations");
    (pool, dir)
}

#[cfg(test)]
fn rand_bytes() -> [u8; 8] {
    let mut bytes = [0; 8];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes
}
