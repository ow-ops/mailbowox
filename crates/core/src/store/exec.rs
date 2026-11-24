use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

use mailbowox_sql::{Request, Response, Rows, Statement, decode, encode};

use crate::error::CoreError;

/// Runs batches where the core cannot open a file itself: the OPFS worker on
/// the web, the shell process on the desktop. An encoded [`Request`] in, its
/// encoded [`Response`] out.
#[cfg(not(target_arch = "wasm32"))]
#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait SqlRunner: Send + Sync {
    async fn run(&self, request: Vec<u8>) -> Vec<u8>;
}

/// Wasm has no threads, and its callbacks' futures are not `Send`.
#[cfg(target_arch = "wasm32")]
#[uniffi::export(with_foreign)]
#[async_trait::async_trait(?Send)]
pub trait SqlRunner {
    async fn run(&self, request: Vec<u8>) -> Vec<u8>;
}

pub(super) enum Exec {
    #[cfg(not(target_arch = "wasm32"))]
    Native(Arc<std::sync::Mutex<rusqlite::Connection>>),
    Foreign {
        runner: Arc<dyn SqlRunner>,
        database: String,
        next: AtomicU32,
    },
}

impl Exec {
    pub(super) async fn batch(&self, statements: Vec<Statement>) -> Result<Vec<Rows>, CoreError> {
        match self {
            #[cfg(not(target_arch = "wasm32"))]
            Self::Native(connection) => {
                let connection = connection.clone();
                let run = move || {
                    let mut connection = connection
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    mailbowox_sql::run_batch(&mut connection, &statements)
                };
                tokio::task::spawn_blocking(run)
                    .await
                    .map_err(CoreError::storage)?
                    .map_err(CoreError::storage)
            }
            Self::Foreign {
                runner,
                database,
                next,
            } => send(runner.as_ref(), database, next, statements).await,
        }
    }
}

async fn send(
    runner: &dyn SqlRunner,
    database: &str,
    next: &AtomicU32,
    statements: Vec<Statement>,
) -> Result<Vec<Rows>, CoreError> {
    let id = next.fetch_add(1, Ordering::Relaxed);
    let request = encode(&Request {
        id,
        database: database.to_owned(),
        statements,
        remove: false,
    });
    let response: Response = decode(&runner.run(request).await).map_err(CoreError::storage)?;
    if response.id != id {
        return Err(CoreError::storage(format!(
            "answer {} came for request {id}",
            response.id
        )));
    }
    response.result.map_err(CoreError::storage)
}
