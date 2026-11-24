//! The device's copy of the mail, kept in SQLite through [`exec::Exec`].

mod bodies;
mod contacts;
mod exec;
mod list;
mod messages;
mod outbox;
mod paging;
mod schema;
mod search;
mod threads;

use std::sync::Arc;

use exec::Exec;
pub use exec::SqlRunner;
pub use paging::OlderMail;

use crate::{
    error::CoreError,
    session::MailSession,
    types::{KnownMessage, SyncOutcome},
};

#[derive(uniffi::Object)]
pub struct MailStore {
    exec: Exec,
    /// Held from the reads a write depends on to the write, as a batch is the
    /// only transaction and a sync reads the thread index before writing.
    writes: async_lock::Mutex<()>,
    exhausted: paging::Exhausted,
}

impl MailStore {
    async fn rows(
        &self,
        statement: mailbowox_sql::Statement,
    ) -> Result<mailbowox_sql::Rows, CoreError> {
        Ok(self
            .exec
            .batch(vec![statement])
            .await?
            .pop()
            .unwrap_or_default())
    }

    #[cfg_attr(
        target_arch = "wasm32",
        expect(
            clippy::arc_with_non_send_sync,
            reason = "wasm is single-threaded and UniFFI wants an Arc"
        )
    )]
    async fn with(exec: Exec) -> Result<Arc<Self>, CoreError> {
        schema::migrate(&exec).await?;
        Ok(Arc::new(Self {
            exec,
            writes: async_lock::Mutex::new(()),
            exhausted: paging::Exhausted::default(),
        }))
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[uniffi::export(async_runtime = "tokio")]
impl MailStore {
    #[uniffi::constructor]
    pub async fn open(path: String) -> Result<Arc<Self>, CoreError> {
        let connection = tokio::task::spawn_blocking(move || {
            if let Some(dir) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(dir).map_err(CoreError::storage)?;
            }
            let connection = rusqlite::Connection::open(&path).map_err(CoreError::storage)?;
            mailbowox_sql::prepare(&connection, true).map_err(CoreError::storage)?;
            Ok::<_, CoreError>(connection)
        })
        .await
        .map_err(CoreError::storage)??;
        Self::with(Exec::Native(Arc::new(std::sync::Mutex::new(connection)))).await
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    #[uniffi::constructor]
    pub async fn open_with(
        runner: Arc<dyn SqlRunner>,
        database: String,
    ) -> Result<Arc<Self>, CoreError> {
        Self::with(Exec::Foreign {
            runner,
            database,
            next: std::sync::atomic::AtomicU32::new(1),
        })
        .await
    }

    pub async fn sync_mailbox(
        &self,
        session: Arc<MailSession>,
        account: String,
        mailbox: String,
        limit: u32,
    ) -> Result<SyncOutcome, CoreError> {
        let since = self.sync_state(account.clone(), mailbox.clone()).await?;
        let known: Vec<KnownMessage> = match since {
            Some(state) => self.known(&account, &mailbox, state.uid_validity).await?,
            None => Vec::new(),
        };
        let result = session.sync(mailbox.clone(), since, known, limit).await?;
        self.apply_sync(&account, &mailbox, &result).await?;
        if result.reset || result.truncated {
            self.exhausted.resume(&account, &mailbox);
        }
        let arrived = match since {
            Some(state) if !result.reset => result
                .changed
                .into_iter()
                .filter(|m| m.uid >= state.uid_next && !m.flags.seen)
                .collect(),
            _ => Vec::new(),
        };
        Ok(SyncOutcome {
            reset: result.reset,
            truncated: result.truncated,
            arrived,
        })
    }
}

#[cfg(test)]
mod tests;
