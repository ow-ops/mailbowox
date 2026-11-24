use std::collections::HashMap;

use mailbowox_sql::{Rows, Statement, Value, statement};

use super::{
    MailStore,
    search::search_text,
    threads::{ThreadIndex, assign_threads, base_subject, thread_ids},
};
use crate::{
    category::Category,
    error::CoreError,
    types::{
        KnownMessage, MailItem, Mailbox, MessageRef, MessageSummary, Oldest, StoredMessage,
        SyncResult, SyncState,
    },
};

pub(super) const COLUMNS: &str = "account, mailbox, uid, uid_validity, thread, summary";

/// Messages from the mailbox's floor up: the list never shows two stretches of
/// a mailbox with unseen mail between them.
pub(super) fn listed(alias: &str) -> String {
    format!(
        "{alias}.uid >= COALESCE((SELECT floor FROM sync_state s WHERE s.account = {alias}.account AND s.mailbox = {alias}.mailbox), 0)"
    )
}

pub(super) fn text(row: &[Value], column: usize) -> Result<&str, CoreError> {
    row.get(column)
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::storage(format!("column {column} is not text")))
}

pub(super) fn integer(row: &[Value], column: usize) -> Result<i64, CoreError> {
    row.get(column)
        .and_then(Value::as_i64)
        .ok_or_else(|| CoreError::storage(format!("column {column} is not an integer")))
}

pub(super) fn uint(row: &[Value], column: usize) -> Result<u32, CoreError> {
    u32::try_from(integer(row, column)?).map_err(CoreError::storage)
}

/// Unix seconds.
pub(super) fn now() -> i64 {
    web_time::SystemTime::now()
        .duration_since(web_time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX)
        })
}

pub(super) fn json<T: serde::Serialize>(value: &T) -> Result<String, CoreError> {
    serde_json::to_string(value).map_err(CoreError::storage)
}

pub(super) fn parse<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, CoreError> {
    serde_json::from_str(text).map_err(CoreError::storage)
}

pub(super) fn stored(row: &[Value]) -> Result<StoredMessage, CoreError> {
    Ok(StoredMessage {
        account: text(row, 0)?.to_owned(),
        mailbox: text(row, 1)?.to_owned(),
        uid: uint(row, 2)?,
        uid_validity: uint(row, 3)?,
        thread: text(row, 4)?.to_owned(),
        summary: parse(text(row, 5)?)?,
    })
}

/// The answers to a batch of `N` statements, in order.
pub(super) fn answers<const N: usize>(rows: Vec<Rows>) -> Result<[Rows; N], CoreError> {
    <[Rows; N]>::try_from(rows)
        .map_err(|rows| CoreError::storage(format!("{} answers to {N} statements", rows.len())))
}

/// The first column of the first row.
fn scalar(rows: &Rows) -> Option<i64> {
    rows.first()?.first()?.as_i64()
}

pub(super) fn message_key(r: &MessageRef) -> [Value; 4] {
    [
        r.account.as_str().into(),
        r.mailbox.as_str().into(),
        i64::from(r.uid).into(),
        i64::from(r.uid_validity).into(),
    ]
}

pub(super) const MESSAGE: &str = "account = ? AND mailbox = ? AND uid = ? AND uid_validity = ?";

fn remove(r: &MessageRef) -> [Statement; 2] {
    [
        Statement {
            sql: format!("DELETE FROM messages WHERE {MESSAGE}"),
            params: message_key(r).to_vec(),
        },
        Statement {
            sql: format!("DELETE FROM bodies WHERE {MESSAGE}"),
            params: message_key(r).to_vec(),
        },
    ]
}

fn sender(summary: &MessageSummary) -> String {
    summary
        .from
        .first()
        .map_or_default(|from| from.email.to_lowercase())
}

/// A conversation with no message left has no use for its ids and subject.
fn forget_empty_threads(account: &str) -> [Statement; 2] {
    ["thread_ids", "thread_subjects"].map(|table| {
        statement!(
            format!(
                "DELETE FROM {table} WHERE account = ? AND thread NOT IN (SELECT thread FROM messages WHERE account = ?)"
            ),
            account,
            account
        )
    })
}

fn clear_mailbox(account: &str, mailbox: &str) -> [Statement; 3] {
    ["messages", "bodies", "sync_state"].map(|table| {
        statement!(
            format!("DELETE FROM {table} WHERE account = ? AND mailbox = ?"),
            account,
            mailbox
        )
    })
}

/// The uid validity of what the mailbox has cached, which may have no sync state yet.
fn generation(account: &str, mailbox: &str) -> Statement {
    statement!(
        "SELECT COALESCE(
           (SELECT uid_validity FROM sync_state WHERE account = ?1 AND mailbox = ?2),
           (SELECT uid_validity FROM messages WHERE account = ?1 AND mailbox = ?2 LIMIT 1))",
        account,
        mailbox
    )
}

fn thread_lookup(
    account: &str,
    summaries: &[&MessageSummary],
) -> Result<[Statement; 2], CoreError> {
    let ids: Vec<String> = summaries.iter().flat_map(|s| thread_ids(s)).collect();
    let subjects: Vec<String> = summaries.iter().map(|s| base_subject(&s.subject)).collect();
    Ok([
        statement!(
            "SELECT message_id, thread FROM thread_ids WHERE account = ? AND message_id IN (SELECT value FROM json_each(?))",
            account,
            json(&ids)?
        ),
        statement!(
            "SELECT subject, thread FROM thread_subjects WHERE account = ? AND subject IN (SELECT value FROM json_each(?))",
            account,
            json(&subjects)?
        ),
    ])
}

fn thread_index(ids: &Rows, subjects: &Rows) -> Result<ThreadIndex, CoreError> {
    let map = |rows: &Rows| {
        rows.iter()
            .map(|row| Ok((text(row, 0)?.to_owned(), text(row, 1)?.to_owned())))
            .collect::<Result<HashMap<_, _>, CoreError>>()
    };
    Ok(ThreadIndex {
        ids: map(ids)?,
        subjects: map(subjects)?,
    })
}

fn upsert(
    account: &str,
    items: &[MailItem],
    mut index: ThreadIndex,
) -> Result<Vec<Statement>, CoreError> {
    let inputs: Vec<(&MessageSummary, String)> = items
        .iter()
        .map(|item| {
            (
                &item.summary,
                format!("{}\n{}", item.mailbox, item.summary.uid),
            )
        })
        .collect();
    let assigned = assign_threads(&mut index, &inputs);
    let mut statements = Vec::new();
    for (from, into) in &assigned.merges {
        for table in ["messages", "thread_ids", "thread_subjects"] {
            statements.push(statement!(
                format!("UPDATE {table} SET thread = ? WHERE account = ? AND thread = ?"),
                into.as_str(),
                account,
                from.as_str()
            ));
        }
    }
    for (id, thread) in &index.ids {
        statements.push(statement!(
            "INSERT OR REPLACE INTO thread_ids (account, message_id, thread) VALUES (?, ?, ?)",
            account,
            id.as_str(),
            thread.as_str()
        ));
    }
    for (subject, thread) in &index.subjects {
        statements.push(statement!(
            "INSERT OR REPLACE INTO thread_subjects (account, subject, thread) VALUES (?, ?, ?)",
            account,
            subject.as_str(),
            thread.as_str()
        ));
    }
    for (item, thread) in items.iter().zip(&assigned.threads) {
        let summary = &item.summary;
        statements.push(statement!(
            // An update keeps the row, and with it the message's place in the search index.
            "INSERT INTO messages (account, mailbox, uid, uid_validity, date, seen, flagged, thread, summary, search, category)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
               (SELECT category FROM sender_categories WHERE account = ?1 AND email = ?11),
               CASE WHEN EXISTS (SELECT 1 FROM correspondents WHERE account = ?1 AND email = ?11) THEN 0 ELSE ?12 END))
             ON CONFLICT (account, mailbox, uid) DO UPDATE SET
               uid_validity = excluded.uid_validity, date = excluded.date, seen = excluded.seen,
               flagged = excluded.flagged, thread = excluded.thread, summary = excluded.summary,
               search = excluded.search, category = excluded.category",
            account,
            item.mailbox.as_str(),
            i64::from(summary.uid),
            i64::from(item.uid_validity),
            summary.date,
            i64::from(summary.flags.seen),
            i64::from(summary.flags.flagged),
            thread.as_str(),
            json(summary)?,
            search_text(summary),
            sender(summary),
            summary.category.code()
        ));
        // Mail the account sent tells who it writes to.
        let recipients: Vec<String> = summary
            .to
            .iter()
            .chain(&summary.cc)
            .map(|a| a.email.to_lowercase())
            .collect();
        statements.push(statement!(
            "INSERT OR IGNORE INTO correspondents (account, email)
             SELECT ?1, value FROM json_each(?2)
             WHERE EXISTS (SELECT 1 FROM own_addresses WHERE account = ?1 AND email = ?3)",
            account,
            json(&recipients)?,
            sender(summary)
        ));
        for address in summary.from.iter().chain(&summary.to).chain(&summary.cc) {
            statements.push(statement!(
                "INSERT INTO addresses (account, email, name, seen_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (account, email) DO UPDATE SET
                   name = CASE WHEN excluded.seen_at >= seen_at AND excluded.name IS NOT NULL THEN excluded.name ELSE name END,
                   seen_at = MAX(seen_at, excluded.seen_at)",
                account,
                address.email.to_lowercase(),
                address.name.clone().filter(|name| !name.is_empty()),
                summary.date
            ));
        }
    }
    Ok(statements)
}

fn new_floor(result: &SyncResult, stored: Option<(i64, i64)>, reset: bool) -> i64 {
    let next = i64::from(result.state.uid_next);
    let uids = result.changed.iter().map(|s| i64::from(s.uid));
    match stored {
        Some((floor, _)) if !reset && !result.truncated => floor,
        Some((_, uid_next)) if !reset => uids.filter(|&uid| uid >= uid_next).fold(next, i64::min),
        _ => uids.fold(next, i64::min),
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    pub async fn save_mailboxes(
        &self,
        account: String,
        mailboxes: Vec<Mailbox>,
    ) -> Result<(), CoreError> {
        let account = account.as_str();
        let mut statements = vec![statement!(
            "DELETE FROM mailboxes WHERE account = ?",
            account
        )];
        for (position, mailbox) in mailboxes.iter().enumerate() {
            statements.push(statement!(
                "INSERT INTO mailboxes (account, name, position, mailbox) VALUES (?, ?, ?, ?)",
                account,
                mailbox.name.as_str(),
                i64::try_from(position).unwrap_or(i64::MAX),
                json(mailbox)?
            ));
        }
        self.exec.batch(statements).await?;
        Ok(())
    }

    pub async fn mailboxes(&self, account: String) -> Result<Vec<Mailbox>, CoreError> {
        let account = account.as_str();
        let rows = self
            .rows(statement!(
                "SELECT mailbox FROM mailboxes WHERE account = ? ORDER BY position",
                account
            ))
            .await?;
        rows.iter().map(|row| parse(text(row, 0)?)).collect()
    }

    pub async fn sync_state(
        &self,
        account: String,
        mailbox: String,
    ) -> Result<Option<SyncState>, CoreError> {
        let (account, mailbox) = (account.as_str(), mailbox.as_str());
        let rows = self
            .rows(statement!(
                "SELECT uid_validity, uid_next, highest_modseq FROM sync_state WHERE account = ? AND mailbox = ?",
                account,
                mailbox
            ))
            .await?;
        rows.first()
            .map(|row| {
                Ok(SyncState {
                    uid_validity: uint(row, 0)?,
                    uid_next: uint(row, 1)?,
                    highest_modseq: row
                        .get(2)
                        .and_then(Value::as_str)
                        .map(str::parse)
                        .transpose()
                        .map_err(CoreError::storage)?,
                })
            })
            .transpose()
    }

    /// Messages a search or an action brought: a newer uid validity drops what
    /// the mailbox had cached, an older one is ignored.
    pub async fn put_messages(&self, items: Vec<MailItem>) -> Result<(), CoreError> {
        let items = &items;
        let _writing = self.writes.lock().await;
        let mut boxes: Vec<((&str, &str), Vec<MailItem>)> = Vec::new();
        for item in items {
            let key = (item.account.as_str(), item.mailbox.as_str());
            match boxes.iter_mut().find(|(other, _)| *other == key) {
                Some((_, list)) => list.push(item.clone()),
                None => boxes.push((key, vec![item.clone()])),
            }
        }
        for ((account, mailbox), list) in boxes {
            let newest = list
                .iter()
                .map(|item| item.uid_validity)
                .max()
                .unwrap_or_default();
            let list: Vec<MailItem> = list
                .into_iter()
                .filter(|item| item.uid_validity == newest)
                .collect();
            let summaries: Vec<&MessageSummary> = list.iter().map(|item| &item.summary).collect();
            let [ids, subjects] = thread_lookup(account, &summaries)?;
            let [cached, ids, subjects] = answers(
                self.exec
                    .batch(vec![generation(account, mailbox), ids, subjects])
                    .await?,
            )?;
            let previous = scalar(&cached);
            if previous.is_some_and(|previous| previous > i64::from(newest)) {
                continue;
            }
            let mut statements = Vec::new();
            if previous.is_some_and(|previous| previous < i64::from(newest)) {
                statements.extend(clear_mailbox(account, mailbox));
            }
            statements.extend(upsert(account, &list, thread_index(&ids, &subjects)?)?);
            self.exec.batch(statements).await?;
        }
        Ok(())
    }

    /// Older messages the list paged down to, which lowers the mailbox's floor to them.
    pub async fn add_older(
        &self,
        account: String,
        mailbox: String,
        uid_validity: u32,
        summaries: Vec<MessageSummary>,
    ) -> Result<(), CoreError> {
        let (account, mailbox) = (account.as_str(), mailbox.as_str());
        let Some(lowest) = summaries.iter().map(|s| s.uid).min() else {
            return Ok(());
        };
        let _writing = self.writes.lock().await;
        let refs: Vec<&MessageSummary> = summaries.iter().collect();
        let [ids, subjects] = thread_lookup(account, &refs)?;
        let [cached, ids, subjects] = answers(
            self.exec
                .batch(vec![generation(account, mailbox), ids, subjects])
                .await?,
        )?;
        if scalar(&cached) != Some(i64::from(uid_validity)) {
            return Ok(());
        }
        let items: Vec<MailItem> = summaries
            .iter()
            .map(|summary| MailItem {
                account: account.to_owned(),
                mailbox: mailbox.to_owned(),
                uid_validity,
                summary: summary.clone(),
            })
            .collect();
        let mut statements = upsert(account, &items, thread_index(&ids, &subjects)?)?;
        statements.push(statement!(
            "UPDATE sync_state SET floor = MIN(floor, ?) WHERE account = ? AND mailbox = ?",
            i64::from(lowest),
            account,
            mailbox
        ));
        self.exec.batch(statements).await?;
        Ok(())
    }

    pub async fn remove_messages(&self, refs: Vec<MessageRef>) -> Result<(), CoreError> {
        let refs = &refs;
        let _writing = self.writes.lock().await;
        let mut statements: Vec<Statement> = refs.iter().flat_map(remove).collect();
        let mut accounts: Vec<&str> = refs.iter().map(|r| r.account.as_str()).collect();
        accounts.sort_unstable();
        accounts.dedup();
        for account in accounts {
            statements.extend(forget_empty_threads(account));
        }
        self.exec.batch(statements).await?;
        Ok(())
    }

    pub async fn oldest(
        &self,
        account: String,
        mailbox: String,
    ) -> Result<Option<Oldest>, CoreError> {
        let (account, mailbox) = (account.as_str(), mailbox.as_str());
        let rows = self
            .rows(statement!(
                format!(
                    "SELECT MIN(uid), MIN(date), uid_validity FROM messages
                     WHERE account = ? AND mailbox = ? AND {} GROUP BY uid_validity",
                    listed("messages")
                ),
                account,
                mailbox
            ))
            .await?;
        rows.first()
            .map(|row| {
                Ok(Oldest {
                    uid: uint(row, 0)?,
                    date: integer(row, 1)?,
                    uid_validity: uint(row, 2)?,
                })
            })
            .transpose()
    }

    pub async fn unread_counts(&self, account: String) -> Result<HashMap<String, u32>, CoreError> {
        let account = account.as_str();
        let rows = self
            .rows(statement!(
                format!(
                    "SELECT mailbox, COUNT(*) FROM messages WHERE account = ? AND seen = 0 AND {} GROUP BY mailbox",
                    listed("messages")
                ),
                account
            ))
            .await?;
        rows.iter()
            .map(|row| Ok((text(row, 0)?.to_owned(), uint(row, 1)?)))
            .collect()
    }

    pub async fn stored_accounts(&self) -> Result<Vec<String>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT account FROM mailboxes UNION SELECT account FROM messages UNION SELECT account FROM sync_state UNION SELECT account FROM outbox UNION SELECT account FROM address_books UNION SELECT account FROM contacts"
            ))
            .await?;
        rows.iter()
            .map(|row| Ok(text(row, 0)?.to_owned()))
            .collect()
    }

    /// The account's own addresses, which tell its sent mail apart.
    pub async fn set_own_addresses(
        &self,
        account: String,
        emails: Vec<String>,
    ) -> Result<(), CoreError> {
        let mut statements = vec![statement!(
            "DELETE FROM own_addresses WHERE account = ?",
            account.as_str()
        )];
        statements.extend(emails.into_iter().map(|email| {
            statement!(
                "INSERT OR IGNORE INTO own_addresses (account, email) VALUES (?, ?)",
                account.as_str(),
                email.to_lowercase()
            )
        }));
        self.exec.batch(statements).await.map(drop)
    }

    /// Puts the sender's past and future mail in `category`.
    pub async fn move_sender(
        &self,
        account: String,
        email: String,
        category: Category,
    ) -> Result<(), CoreError> {
        let email = email.to_lowercase();
        self.exec
            .batch(vec![
                statement!(
                    "INSERT OR REPLACE INTO sender_categories (account, email, category) VALUES (?, ?, ?)",
                    account.as_str(),
                    email.as_str(),
                    category.code()
                ),
                statement!(
                    "UPDATE messages SET category = ? WHERE account = ? AND lower(json_extract(summary, '$.from[0].email')) = ?",
                    category.code(),
                    account,
                    email
                ),
            ])
            .await
            .map(drop)
    }

    pub async fn delete_account(&self, account: String) -> Result<(), CoreError> {
        let account = account.as_str();
        let _writing = self.writes.lock().await;
        let statements = [
            "mailboxes",
            "messages",
            "sync_state",
            "bodies",
            "thread_ids",
            "thread_subjects",
            "addresses",
            "outbox",
            "address_books",
            "contacts",
            "own_addresses",
            "correspondents",
            "sender_categories",
        ]
        .map(|table| statement!(format!("DELETE FROM {table} WHERE account = ?"), account));
        self.exec.batch(statements.to_vec()).await?;
        Ok(())
    }
}

impl MailStore {
    /// Listed or not: the server compares every cached message.
    pub(super) async fn known(
        &self,
        account: &str,
        mailbox: &str,
        uid_validity: u32,
    ) -> Result<Vec<KnownMessage>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT uid, json_extract(summary, '$.flags') FROM messages WHERE account = ? AND mailbox = ? AND uid_validity = ?",
                account,
                mailbox,
                i64::from(uid_validity)
            ))
            .await?;
        rows.iter()
            .map(|row| {
                Ok(KnownMessage {
                    uid: uint(row, 0)?,
                    flags: parse(text(row, 1)?)?,
                })
            })
            .collect()
    }

    /// A reset starts the list over. So does a sync that left new mail out: the
    /// floor rises to the oldest message it did bring, and paging down fetches
    /// through the gap to the older messages still cached.
    pub(super) async fn apply_sync(
        &self,
        account: &str,
        mailbox: &str,
        result: &SyncResult,
    ) -> Result<(), CoreError> {
        let _writing = self.writes.lock().await;
        let summaries: Vec<&MessageSummary> = result.changed.iter().collect();
        let [ids, subjects] = thread_lookup(account, &summaries)?;
        let [state, cached, ids, subjects] = answers(
            self.exec
                .batch(vec![
                statement!(
                    "SELECT floor, uid_next, uid_validity FROM sync_state WHERE account = ? AND mailbox = ?",
                    account,
                    mailbox
                ),
                generation(account, mailbox),
                ids,
                subjects,
            ])
            .await?,
        )?;
        let stored = state
            .first()
            .map(|row| Ok::<_, CoreError>((integer(row, 0)?, integer(row, 1)?)))
            .transpose()?;
        let previous = scalar(&cached);
        let validity = i64::from(result.state.uid_validity);
        if previous.is_some_and(|previous| previous > validity) {
            return Ok(());
        }
        let reset = result.reset || previous.is_some_and(|previous| previous != validity);
        let floor = new_floor(result, stored, reset);
        let mut statements = Vec::new();
        if reset {
            statements.extend(clear_mailbox(account, mailbox));
        }
        for &uid in &result.vanished {
            statements.extend(remove(&MessageRef {
                account: account.to_owned(),
                mailbox: mailbox.to_owned(),
                uid_validity: result.state.uid_validity,
                uid,
            }));
        }
        let items: Vec<MailItem> = result
            .changed
            .iter()
            .map(|summary| MailItem {
                account: account.to_owned(),
                mailbox: mailbox.to_owned(),
                uid_validity: result.state.uid_validity,
                summary: summary.clone(),
            })
            .collect();
        statements.extend(upsert(account, &items, thread_index(&ids, &subjects)?)?);
        if reset || !result.vanished.is_empty() {
            statements.extend(forget_empty_threads(account));
        }
        statements.push(statement!(
            "INSERT OR REPLACE INTO sync_state (account, mailbox, uid_validity, uid_next, highest_modseq, floor) VALUES (?, ?, ?, ?, ?, ?)",
            account,
            mailbox,
            validity,
            i64::from(result.state.uid_next),
            result.state.highest_modseq.map(|modseq| modseq.to_string()),
            floor
        ));
        self.exec.batch(statements).await?;
        Ok(())
    }
}
