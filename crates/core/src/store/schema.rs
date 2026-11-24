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
    &[
        "CREATE TABLE address_books (
           account TEXT NOT NULL,
           href TEXT NOT NULL,
           position INTEGER NOT NULL,
           name TEXT NOT NULL,
           read_only INTEGER NOT NULL,
           ctag TEXT,
           sync_token TEXT,
           PRIMARY KEY (account, href)
         )",
        "CREATE TABLE contacts (
           account TEXT NOT NULL,
           href TEXT NOT NULL,
           book TEXT NOT NULL,
           uid TEXT NOT NULL,
           etag TEXT,
           name TEXT NOT NULL,
           given TEXT,
           family TEXT,
           organization TEXT,
           emails TEXT NOT NULL,
           phones TEXT NOT NULL,
           photo TEXT,
           vcard TEXT NOT NULL,
           sort TEXT NOT NULL,
           search TEXT NOT NULL,
           PRIMARY KEY (account, href)
         )",
        "CREATE INDEX contacts_by_book ON contacts (account, book)",
        "CREATE INDEX contacts_by_sort ON contacts (sort)",
    ],
    &[
        // What local search looks in: the subject, people and preview, then the
        // body text of each message once it has been opened. A body's text stays
        // after the cache drops the body, so the message is still found.
        "CREATE VIRTUAL TABLE message_text USING fts5(head, body, tokenize = 'unicode61 remove_diacritics 2')",
        "INSERT INTO message_text (rowid, head, body)
           SELECT m.rowid, m.search, COALESCE(
             (SELECT json_extract(b.body, '$.text') FROM bodies b
              WHERE b.account = m.account AND b.mailbox = m.mailbox AND b.uid = m.uid AND b.uid_validity = m.uid_validity),
             '')
           FROM messages m",
        "CREATE TRIGGER message_text_insert AFTER INSERT ON messages BEGIN
           INSERT INTO message_text (rowid, head, body) VALUES (new.rowid, new.search, '');
         END",
        "CREATE TRIGGER message_text_update AFTER UPDATE OF search ON messages BEGIN
           UPDATE message_text SET head = new.search WHERE rowid = new.rowid;
         END",
        // A uid the server gave a new message keeps the row; the old body text goes.
        "CREATE TRIGGER message_text_reused AFTER UPDATE OF uid_validity ON messages
           WHEN old.uid_validity != new.uid_validity BEGIN
           UPDATE message_text SET body = '' WHERE rowid = new.rowid;
         END",
        "CREATE TRIGGER message_text_delete AFTER DELETE ON messages BEGIN
           DELETE FROM message_text WHERE rowid = old.rowid;
         END",
    ],
    &[
        "ALTER TABLE messages ADD COLUMN category INTEGER NOT NULL DEFAULT 0",
        // Each account's own addresses, so its sent mail shows who it writes to.
        "CREATE TABLE own_addresses (
           account TEXT NOT NULL,
           email TEXT NOT NULL,
           PRIMARY KEY (account, email)
         )",
        // People the account writes to: their mail is Primary however it was sent.
        "CREATE TABLE correspondents (
           account TEXT NOT NULL,
           email TEXT NOT NULL,
           PRIMARY KEY (account, email)
         )",
        // Senders moved to a category by hand, with their past and future mail.
        "CREATE TABLE sender_categories (
           account TEXT NOT NULL,
           email TEXT NOT NULL,
           category INTEGER NOT NULL,
           PRIMARY KEY (account, email)
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
