use mailbowox_sql::{Statement, Value, statement};

use super::{
    MailStore,
    messages::{COLUMNS, MESSAGE, json, listed, message_key, stored, uint},
    threads::conversation,
};
use crate::{
    error::CoreError,
    types::{
        Conversation, ListFilter, MailboxRef, MailboxRole, MessageRef, PageCursor, StoredMessage,
    },
};

fn in_boxes(boxes: &[MailboxRef], alias: &str) -> (String, Vec<Value>) {
    let sql =
        vec![format!("({alias}.account = ? AND {alias}.mailbox = ?)"); boxes.len()].join(" OR ");
    let params = boxes
        .iter()
        .flat_map(|b| [b.account.as_str().into(), b.mailbox.as_str().into()])
        .collect();
    (format!("({sql})"), params)
}

fn narrowed(alias: &str, filter: &ListFilter) -> Result<(String, Vec<Value>), CoreError> {
    let mut conditions = Vec::new();
    let mut params = Vec::new();
    if filter.unread {
        conditions.push(format!("{alias}.seen = 0"));
    }
    if filter.flagged {
        conditions.push(format!("{alias}.flagged = 1"));
    }
    if filter.attachments {
        conditions.push(format!(
            "json_extract({alias}.summary, '$.has_attachments')"
        ));
    }
    if let Some(category) = filter.category {
        conditions.push(format!("{alias}.category = ?"));
        params.push(category.code().into());
    }
    if let Some(since) = filter.since {
        conditions.push(format!("{alias}.date >= ?"));
        params.push(since.into());
    }
    let me: Vec<String> = filter.me.iter().map(|email| email.to_lowercase()).collect();
    for (on, field) in [(filter.to_me, "to"), (filter.cc_me, "cc")] {
        if on {
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM json_each({alias}.summary, '$.{field}') r
                 WHERE lower(json_extract(r.value, '$.email')) IN (SELECT value FROM json_each(?)))"
            ));
            params.push(json(&me)?.into());
        }
    }
    Ok((
        conditions
            .iter()
            .fold(String::new(), |sql, condition| sql + " AND " + condition),
        params,
    ))
}

fn shown(
    boxes: &[MailboxRef],
    alias: &str,
    filter: &ListFilter,
) -> Result<(String, Vec<Value>), CoreError> {
    let (within, mut params) = in_boxes(boxes, alias);
    let (narrow, values) = narrowed(alias, filter)?;
    params.extend(values);
    Ok((format!("{within} AND {}{narrow}", listed(alias)), params))
}

fn cursor_params(before: Option<&PageCursor>) -> Vec<Value> {
    before.map_or_else(Vec::new, |c| {
        vec![
            c.date.into(),
            c.account.as_str().into(),
            i64::from(c.uid).into(),
        ]
    })
}

fn limit_value(limit: u32) -> Value {
    i64::from(limit).into()
}

fn messages_page(
    boxes: &[MailboxRef],
    before: Option<&PageCursor>,
    limit: u32,
    filter: &ListFilter,
) -> Result<Statement, CoreError> {
    let (condition, mut params) = shown(boxes, "messages", filter)?;
    params.extend(cursor_params(before));
    params.push(limit_value(limit));
    Ok(Statement {
        sql: format!(
            "SELECT {COLUMNS} FROM messages WHERE {condition} {}
             ORDER BY date DESC, account DESC, uid DESC LIMIT ?",
            if before.is_some() {
                "AND (date, account, uid) < (?, ?, ?)"
            } else {
                ""
            }
        ),
        params,
    })
}

/// One row per conversation: the message no other of its conversation in these
/// mailboxes is newer than. The rows come off the date index and each looks its
/// conversation up, so a page reads about a page of messages. The lookup names
/// its index: left to choose, SQLite scans the mailbox's newer messages for each row.
pub(super) fn conversations_page(
    boxes: &[MailboxRef],
    before: Option<&PageCursor>,
    limit: u32,
    filter: &ListFilter,
) -> Result<Statement, CoreError> {
    let (outer, mut params) = shown(boxes, "m", filter)?;
    let (inner, inner_params) = shown(boxes, "n", filter)?;
    params.extend(inner_params);
    params.extend(cursor_params(before));
    params.push(limit_value(limit));
    let columns = COLUMNS
        .split(", ")
        .map(|column| format!("m.{column}"))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(Statement {
        sql: format!(
            "SELECT {columns} FROM messages m
             WHERE {outer}
               AND NOT EXISTS (
                 SELECT 1 FROM messages n INDEXED BY messages_by_thread
                 WHERE n.account = m.account AND n.thread = m.thread AND {inner}
                   AND (n.date, n.uid, n.mailbox) > (m.date, m.uid, m.mailbox)
               )
               {}
             ORDER BY m.date DESC, m.account DESC, m.uid DESC LIMIT ?",
            if before.is_some() {
                "AND (m.date, m.account, m.uid) < (?, ?, ?)"
            } else {
                ""
            }
        ),
        params,
    })
}

fn newest_first(a: &StoredMessage, b: &StoredMessage) -> std::cmp::Ordering {
    b.summary
        .date
        .cmp(&a.summary.date)
        .then_with(|| b.account.cmp(&a.account))
        .then_with(|| b.uid.cmp(&a.uid))
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailStore {
    /// A page across accounts is each account's own page, merged: one account's
    /// mailboxes come off its date index already in order, where sorting several
    /// accounts together reads all of them.
    pub async fn page(
        &self,
        boxes: Vec<MailboxRef>,
        before: Option<PageCursor>,
        limit: u32,
        grouped: bool,
        filter: ListFilter,
    ) -> Result<Vec<Conversation>, CoreError> {
        let (before, filter) = (before.as_ref(), &filter);
        let mut accounts: Vec<&str> = boxes.iter().map(|b| b.account.as_str()).collect();
        accounts.sort_unstable();
        accounts.dedup();
        let mut statements = Vec::new();
        for account in &accounts {
            let own: Vec<MailboxRef> = boxes
                .iter()
                .filter(|b| b.account == *account)
                .cloned()
                .collect();
            statements.push(if grouped {
                conversations_page(&own, before, limit, filter)?
            } else {
                messages_page(&own, before, limit, filter)?
            });
        }
        let rows = self.exec.batch(statements).await?;
        let mut latest = rows
            .iter()
            .flatten()
            .map(|row| stored(row))
            .collect::<Result<Vec<_>, _>>()?;
        latest.sort_by(newest_first);
        latest.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
        if grouped {
            self.with_conversations(latest).await
        } else {
            Ok(latest.into_iter().map(single).collect())
        }
    }

    /// How many messages of these mailboxes the filter keeps.
    pub async fn count(
        &self,
        boxes: Vec<MailboxRef>,
        filter: ListFilter,
    ) -> Result<u32, CoreError> {
        let (condition, params) = shown(&boxes, "messages", &filter)?;
        let rows = self
            .rows(Statement {
                sql: format!("SELECT COUNT(*) FROM messages WHERE {condition}"),
                params,
            })
            .await?;
        rows.first().map_or(Ok(0), |row| uint(row, 0))
    }

    pub async fn message(&self, message: MessageRef) -> Result<Option<StoredMessage>, CoreError> {
        let r = &message;
        let rows = self
            .rows(Statement {
                sql: format!("SELECT {COLUMNS} FROM messages WHERE {MESSAGE}"),
                params: message_key(r).to_vec(),
            })
            .await?;
        rows.first().map(|row| stored(row)).transpose()
    }

    pub async fn conversation(
        &self,
        message: MessageRef,
        grouped: bool,
    ) -> Result<Option<Conversation>, CoreError> {
        let Some(message) = self.message(message).await? else {
            return Ok(None);
        };
        if !grouped {
            return Ok(Some(single(message)));
        }
        Ok(self.with_conversations(vec![message]).await?.pop())
    }

    pub async fn messages(&self, refs: Vec<MessageRef>) -> Result<Vec<StoredMessage>, CoreError> {
        let keys: Vec<(&str, &str, u32, u32)> = refs
            .iter()
            .map(|r| {
                (
                    r.account.as_str(),
                    r.mailbox.as_str(),
                    r.uid,
                    r.uid_validity,
                )
            })
            .collect();
        let rows = self
            .rows(statement!(
                format!(
                    "SELECT {COLUMNS} FROM messages WHERE (account, mailbox, uid, uid_validity) IN (
                       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]')
                       FROM json_each(?))"
                ),
                json(&keys)?
            ))
            .await?;
        rows.iter().map(|row| stored(row)).collect()
    }

    pub async fn thread_items(
        &self,
        account: String,
        mailbox: String,
        uid_validity: u32,
        thread: String,
    ) -> Result<Vec<StoredMessage>, CoreError> {
        let (account, mailbox, thread) = (account.as_str(), mailbox.as_str(), thread.as_str());
        let rows = self
            .rows(statement!(
                format!("SELECT {COLUMNS} FROM messages WHERE account = ? AND mailbox = ? AND uid_validity = ? AND thread = ?"),
                account,
                mailbox,
                i64::from(uid_validity),
                thread
            ))
            .await?;
        rows.iter().map(|row| stored(row)).collect()
    }
}

impl MailStore {
    pub(super) async fn with_conversations(
        &self,
        latest: Vec<StoredMessage>,
    ) -> Result<Vec<Conversation>, CoreError> {
        let threads: Vec<(&str, &str)> = latest
            .iter()
            .map(|m| (m.account.as_str(), m.thread.as_str()))
            .collect();
        let rows = self
            .rows(statement!(
                format!(
                    "SELECT {COLUMNS} FROM messages WHERE (account, thread) IN (
                       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))"
                ),
                json(&threads)?
            ))
            .await?;
        let members = rows
            .iter()
            .map(|row| stored(row))
            .collect::<Result<Vec<_>, _>>()?;
        let mut hidden: Vec<(String, Vec<String>)> = Vec::new();
        for message in &latest {
            if hidden
                .iter()
                .all(|(account, _)| *account != message.account)
            {
                let names = self
                    .mailboxes(message.account.clone())
                    .await?
                    .into_iter()
                    .filter(|m| matches!(m.role, Some(MailboxRole::Trash | MailboxRole::Junk)))
                    .map(|m| m.name)
                    .collect();
                hidden.push((message.account.clone(), names));
            }
        }
        Ok(latest
            .into_iter()
            .map(|latest| {
                let own: Vec<StoredMessage> = members
                    .iter()
                    .filter(|m| m.account == latest.account && m.thread == latest.thread)
                    .cloned()
                    .collect();
                let hidden = hidden
                    .iter()
                    .find(|(account, _)| *account == latest.account)
                    .map_or_default(|(_, names)| names.as_slice());
                let (messages, in_view) = conversation(&latest, &own, hidden);
                Conversation {
                    latest,
                    messages,
                    in_view,
                }
            })
            .collect())
    }
}

fn single(message: StoredMessage) -> Conversation {
    Conversation {
        latest: message.clone(),
        messages: vec![message.clone()],
        in_view: vec![message],
    }
}
