use std::{
    collections::HashMap,
    sync::{Arc, PoisonError},
};

use super::MailStore;
use crate::{
    error::CoreError,
    types::{Conversation, ListFilter, MailboxRef, MessageRef, MessageSummary, PageCursor},
};

/// Fetches mail older than what the store holds, for a page that reaches past it.
#[cfg(not(target_arch = "wasm32"))]
#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait OlderMail: Send + Sync {
    /// Up to `limit` messages of the mailbox older than `before`, newest first.
    async fn fetch_older(
        &self,
        before: MessageRef,
        limit: u32,
    ) -> Result<Vec<MessageSummary>, CoreError>;
}

#[cfg(target_arch = "wasm32")]
#[uniffi::export(with_foreign)]
#[async_trait::async_trait(?Send)]
pub trait OlderMail {
    async fn fetch_older(
        &self,
        before: MessageRef,
        limit: u32,
    ) -> Result<Vec<MessageSummary>, CoreError>;
}

/// The uid validity of each mailbox whose oldest message the server has already given.
#[derive(Default)]
pub(super) struct Exhausted(std::sync::Mutex<HashMap<(String, String), u32>>);

impl Exhausted {
    fn get(&self, account: &str, mailbox: &str) -> Option<u32> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&(account.to_owned(), mailbox.to_owned()))
            .copied()
    }

    fn set(&self, account: &str, mailbox: &str, uid_validity: u32) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert((account.to_owned(), mailbox.to_owned()), uid_validity);
    }

    /// After a sync that started the list over or left a gap, there is older mail to fetch again.
    pub(super) fn resume(&self, account: &str, mailbox: &str) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&(account.to_owned(), mailbox.to_owned()));
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    /// Like [`Self::page`], fetching older mail first wherever a mailbox's copy
    /// ends above the page: until then its older mail could belong in it. One
    /// fetch may not be enough, as a page of conversations can span many messages.
    pub async fn load_page(
        &self,
        boxes: Vec<MailboxRef>,
        before: Option<PageCursor>,
        limit: u32,
        grouped: bool,
        filter: ListFilter,
        older: Arc<dyn OlderMail>,
    ) -> Result<Vec<Conversation>, CoreError> {
        let mut page = self
            .page(
                boxes.clone(),
                before.clone(),
                limit,
                grouped,
                filter.clone(),
            )
            .await?;
        if before.is_none() {
            return Ok(page);
        }
        loop {
            let full = page.len() == usize::try_from(limit).unwrap_or(usize::MAX);
            let end = page
                .last()
                .filter(|_| full)
                .map_or(i64::MIN, |last| last.latest.summary.date);
            let mut behind = Vec::new();
            for b in &boxes {
                let Some(local) = self.oldest(b.account.clone(), b.mailbox.clone()).await? else {
                    continue;
                };
                if self.exhausted.get(&b.account, &b.mailbox) != Some(local.uid_validity)
                    && local.date > end
                {
                    behind.push(MessageRef {
                        account: b.account.clone(),
                        mailbox: b.mailbox.clone(),
                        uid_validity: local.uid_validity,
                        uid: local.uid,
                    });
                }
            }
            if behind.is_empty() {
                return Ok(page);
            }
            for from in behind {
                let summaries = older.fetch_older(from.clone(), limit).await?;
                if summaries.is_empty() {
                    self.exhausted
                        .set(&from.account, &from.mailbox, from.uid_validity);
                }
                self.add_older(from.account, from.mailbox, from.uid_validity, summaries)
                    .await?;
            }
            page = self
                .page(
                    boxes.clone(),
                    before.clone(),
                    limit,
                    grouped,
                    filter.clone(),
                )
                .await?;
        }
    }
}
