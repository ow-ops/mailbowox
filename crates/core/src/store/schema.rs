use mailbowox_sql::{Statement, statement};

use super::exec::Exec;
use crate::error::CoreError;

/// Migration n takes the database from `user_version` n to n + 1. Never edit
/// one that has shipped: append another.
const MIGRATIONS: &[&[&str]] = &[
    &[
        "CREATE TABLE mailboxes (
       account TEXT NOT NULL,
       name TEXT NOT NULL,
       position INTEGER NOT NULL,
       mailbox TEXT NOT NULL,
       PRIMARY KEY (account, name)
     )",
        "CREATE TABLE messages (
       account TEXT NOT NULL,
       mailbox TEXT NOT NULL,
       uid INTEGER NOT NULL,
       uid_validity INTEGER NOT NULL,
       date INTEGER NOT NULL,
       seen INTEGER NOT NULL,
       flagged INTEGER NOT NULL,
       thread TEXT NOT NULL,
       summary TEXT NOT NULL,
       search TEXT NOT NULL,
       PRIMARY KEY (account, mailbox, uid)
     )",
        "CREATE INDEX messages_by_date ON messages (account, mailbox, date DESC, uid DESC)",
        "CREATE INDEX messages_by_thread ON messages (account, thread)",
        "CREATE INDEX messages_unread ON messages (account, mailbox, date DESC, uid DESC) WHERE seen = 0",
        // `floor` is the oldest UID the list has paged down to. Messages below it
        // came from a search and stay out of the list, which would otherwise skip
        // the ones between.
        "CREATE TABLE sync_state (
       account TEXT NOT NULL,
       mailbox TEXT NOT NULL,
       uid_validity INTEGER NOT NULL,
       uid_next INTEGER NOT NULL,
       highest_modseq TEXT,
       floor INTEGER NOT NULL,
       PRIMARY KEY (account, mailbox)
     )",
        "CREATE TABLE bodies (
       account TEXT NOT NULL,
       mailbox TEXT NOT NULL,
       uid INTEGER NOT NULL,
       uid_validity INTEGER NOT NULL,
       remote INTEGER NOT NULL,
       blocked INTEGER NOT NULL,
       body TEXT NOT NULL,
       size INTEGER NOT NULL,
       opened_at INTEGER NOT NULL,
       PRIMARY KEY (account, mailbox, uid)
     )",
        "CREATE TABLE thread_ids (
       account TEXT NOT NULL,
       message_id TEXT NOT NULL,
       thread TEXT NOT NULL,
       PRIMARY KEY (account, message_id)
     )",
        "CREATE INDEX thread_ids_by_thread ON thread_ids (account, thread)",
        "CREATE TABLE thread_subjects (
       account TEXT NOT NULL,
       subject TEXT NOT NULL,
       thread TEXT NOT NULL,
       PRIMARY KEY (account, subject)
     )",
        "CREATE TABLE addresses (
       account TEXT NOT NULL,
       email TEXT NOT NULL,
       name TEXT,
       seen_at INTEGER NOT NULL,
       PRIMARY KEY (account, email)
     )",
    ],
    &[
        // Messages written offline wait here until they can be sent; `draft` is the Draft without its attachments.
        "CREATE TABLE outbox (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       account TEXT NOT NULL,
       queued_at INTEGER NOT NULL,
       draft TEXT NOT NULL,
       error TEXT
     )",
        "CREATE TABLE outbox_attachments (
       outbox INTEGER NOT NULL REFERENCES outbox (id) ON DELETE CASCADE,
       position INTEGER NOT NULL,
       filename TEXT NOT NULL,
       mime_type TEXT NOT NULL,
       data BLOB NOT NULL,
       PRIMARY KEY (outbox, position)
     )",
        "CREATE TABLE draft_attachments (
       slot TEXT NOT NULL,
       position INTEGER NOT NULL,
       key TEXT NOT NULL,
       filename TEXT NOT NULL,
       mime_type TEXT NOT NULL,
       size INTEGER NOT NULL,
       data BLOB,
       PRIMARY KEY (slot, position)
     )",
    ],
];

pub(super) async fn migrate(exec: &Exec) -> Result<(), CoreError> {
    let rows = exec.batch(vec![statement!("PRAGMA user_version")]).await?;
    let current = rows
        .first()
        .and_then(|rows| rows.first())
        .and_then(|row| row.first())
        .and_then(mailbowox_sql::Value::as_i64)
        .and_then(|version| usize::try_from(version).ok())
        .unwrap_or_default();
    if current > MIGRATIONS.len() {
        return Err(CoreError::storage(
            "the store was written by a newer version of the app",
        ));
    }
    for (version, migration) in MIGRATIONS.iter().enumerate().skip(current) {
        let mut statements: Vec<Statement> = migration.iter().map(|sql| statement!(*sql)).collect();
        statements.push(statement!(format!("PRAGMA user_version = {}", version + 1)));
        exec.batch(statements).await?;
    }
    Ok(())
}
