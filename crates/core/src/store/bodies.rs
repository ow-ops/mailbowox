use mailbowox_sql::{Value, statement};

use super::{
    MailStore,
    messages::{COLUMNS, MESSAGE, answers, integer, json, message_key, now, parse, stored, text},
};
use crate::{
    error::CoreError,
    types::{Address, MessageBody, MessageRef, SearchQuery, StoredMessage},
};

const BODY_CACHE_BYTES: i64 = 50 * 1024 * 1024;

/// How many messages that mention a field's value are checked against the
/// field itself: far above a page of results, and still a bound on one keystroke.
const FIELD_CANDIDATES: u32 = 5000;

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    /// A body fetched without remote content does not answer a request that allows it.
    pub async fn cached_body(
        &self,
        message: MessageRef,
        allow_remote: bool,
    ) -> Result<Option<MessageBody>, CoreError> {
        let r = &message;
        let mut touch = statement!(
            format!("UPDATE bodies SET opened_at = ? WHERE {MESSAGE}"),
            now()
        );
        touch.params.extend(message_key(r));
        let mut read = statement!(format!("SELECT remote, body FROM bodies WHERE {MESSAGE}"));
        read.params.extend(message_key(r));
        let [found, _] = answers(self.exec.batch(vec![read, touch]).await?)?;
        let Some(row) = found.first() else {
            return Ok(None);
        };
        if allow_remote && integer(row, 0)? == 0 {
            return Ok(None);
        }
        parse(text(row, 1)?).map(Some)
    }

    /// `None` until the message has been opened.
    pub async fn fetch_body(
        &self,
        session: std::sync::Arc<crate::session::MailSession>,
        message: MessageRef,
        allow_remote: bool,
    ) -> Result<MessageBody, CoreError> {
        let body = session
            .fetch_body(
                message.mailbox.clone(),
                message.uid_validity,
                message.uid,
                allow_remote,
            )
            .await?;
        self.save_body(&message, &body, allow_remote).await?;
        Ok(body)
    }

    pub async fn blocked_count(&self, message: MessageRef) -> Result<Option<u32>, CoreError> {
        let r = &message;
        let mut read = statement!(format!("SELECT blocked FROM bodies WHERE {MESSAGE}"));
        read.params.extend(message_key(r));
        let rows = self.rows(read).await?;
        rows.first()
            .map(|row| u32::try_from(integer(row, 0)?).map_err(CoreError::storage))
            .transpose()
    }

    /// Newest first: anyone who wrote or was written to, across every account.
    pub async fn seen_addresses(&self) -> Result<Vec<Address>, CoreError> {
        let rows = self
            .rows(statement!(
                "SELECT name, email FROM addresses GROUP BY email ORDER BY MAX(seen_at) DESC LIMIT 5000"
            ))
            .await?;
        rows.iter()
            .map(|row| {
                Ok(Address {
                    name: row.first().and_then(Value::as_str).map(str::to_owned),
                    email: text(row, 1)?.to_owned(),
                })
            })
            .collect()
    }

    /// Newest listed or not. The search column holds every field a query
    /// can name, so a field's value only narrows here; the caller checks it
    /// against the field itself.
    pub async fn search(
        &self,
        boxes: Vec<crate::types::MailboxRef>,
        query: SearchQuery,
        limit: u32,
    ) -> Result<Vec<StoredMessage>, CoreError> {
        let query = &query;
        let within = vec!["(account = ? AND mailbox = ?)"; boxes.len()].join(" OR ");
        let mut conditions: Vec<String> = query
            .terms
            .iter()
            .map(|_| "instr(search, ?) > 0".to_owned())
            .collect();
        if let Some(seen) = query.seen {
            conditions.push(format!("seen = {}", i64::from(seen)));
        }
        if query.flagged {
            conditions.push("flagged = 1".to_owned());
        }
        if query.attachments {
            conditions.push("json_extract(summary, '$.has_attachments')".to_owned());
        }
        let mut params: Vec<Value> = boxes
            .iter()
            .flat_map(|b| [b.account.as_str().into(), b.mailbox.as_str().into()])
            .collect();
        params.extend(query.terms.iter().map(|term| term.as_str().into()));
        let bound = if query.fields {
            FIELD_CANDIDATES
        } else {
            limit
        };
        params.push(i64::from(bound).into());
        let rows = self
            .rows(mailbowox_sql::Statement {
                sql: format!(
                    "SELECT {COLUMNS} FROM messages WHERE ({within}){} ORDER BY date DESC, uid DESC LIMIT ?",
                    conditions
                        .iter()
                        .fold(String::new(), |sql, condition| sql + " AND " + condition)
                ),
                params,
            })
            .await?;
        rows.iter().map(|row| stored(row)).collect()
    }
}

impl MailStore {
    /// Keeps the most recently opened bodies up to `BODY_CACHE_BYTES`, and always
    /// the latest one. Flagged messages keep theirs and do not count.
    pub(super) async fn save_body(
        &self,
        r: &MessageRef,
        body: &MessageBody,
        allow_remote: bool,
    ) -> Result<(), CoreError> {
        let mut save = statement!(
            "INSERT OR REPLACE INTO bodies (account, mailbox, uid, uid_validity, remote, blocked, body, size, opened_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, length(CAST(?7 AS BLOB)), ?8
             WHERE EXISTS (SELECT 1 FROM messages WHERE account = ?1 AND mailbox = ?2 AND uid = ?3 AND uid_validity = ?4)"
        );
        save.params.extend(message_key(r));
        save.params.extend([
            i64::from(allow_remote).into(),
            i64::from(body.blocked_remote).into(),
            json(body)?.into(),
            now().into(),
        ]);
        let evict = statement!(
            "DELETE FROM bodies WHERE rowid IN (
               SELECT rowid FROM (
                 SELECT b.rowid AS rowid, SUM(b.size) OVER newest AS total, ROW_NUMBER() OVER newest AS position
                 FROM bodies b
                 WHERE NOT EXISTS (
                   SELECT 1 FROM messages m
                   WHERE m.account = b.account AND m.mailbox = b.mailbox AND m.uid = b.uid AND m.flagged = 1
                 )
                 WINDOW newest AS (ORDER BY b.opened_at DESC, b.rowid DESC)
               ) WHERE total > ? AND position > 1
             )",
            BODY_CACHE_BYTES
        );
        self.exec.batch(vec![save, evict]).await?;
        Ok(())
    }
}
