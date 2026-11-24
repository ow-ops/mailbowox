import { lazyDatabase } from '@/db/migrate';

const SCHEMA = `
  CREATE TABLE mailboxes (
    account TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    mailbox TEXT NOT NULL,
    PRIMARY KEY (account, name)
  );
  CREATE TABLE messages (
    account TEXT NOT NULL,
    mailbox TEXT NOT NULL,
    uid INTEGER NOT NULL,
    uid_validity INTEGER NOT NULL,
    date INTEGER NOT NULL,
    seen INTEGER NOT NULL,
    flagged INTEGER NOT NULL,
    summary TEXT NOT NULL,
    thread TEXT NOT NULL,
    search TEXT NOT NULL,
    PRIMARY KEY (account, mailbox, uid)
  );
  CREATE INDEX messages_by_date ON messages (account, mailbox, date DESC, uid DESC);
  CREATE INDEX messages_by_thread ON messages (account, thread);
  CREATE INDEX messages_unread ON messages (account, mailbox, date DESC, uid DESC) WHERE seen = 0;
  -- \`floor\` is the oldest UID the list has paged down to; messages below it came from a search and stay out of
  -- the list, which would otherwise skip the ones between.
  CREATE TABLE sync_state (
    account TEXT NOT NULL,
    mailbox TEXT NOT NULL,
    uid_validity INTEGER NOT NULL,
    uid_next INTEGER NOT NULL,
    highest_modseq TEXT,
    floor INTEGER NOT NULL,
    PRIMARY KEY (account, mailbox)
  );
  -- Evicted least recently opened first, once their total size passes BODY_CACHE_BYTES.
  CREATE TABLE bodies (
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
  );
  CREATE TABLE thread_ids (
    account TEXT NOT NULL,
    message_id TEXT NOT NULL,
    thread TEXT NOT NULL,
    PRIMARY KEY (account, message_id)
  );
  CREATE INDEX thread_ids_by_thread ON thread_ids (account, thread);
  CREATE TABLE thread_subjects (
    account TEXT NOT NULL,
    subject TEXT NOT NULL,
    thread TEXT NOT NULL,
    PRIMARY KEY (account, subject)
  );
  CREATE TABLE addresses (
    account TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (account, email)
  );
  -- Messages written offline wait here until they can be sent; \`draft\` is the Draft without its attachments.
  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    queued_at INTEGER NOT NULL,
    draft TEXT NOT NULL,
    error TEXT
  );
  CREATE TABLE outbox_attachments (
    outbox INTEGER NOT NULL REFERENCES outbox (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (outbox, position)
  );
  -- The attachments of a composer's local draft, by its slot. A forwarded attachment that was still downloading
  -- has no data and is fetched again when the draft is reopened.
  CREATE TABLE draft_attachments (
    slot TEXT NOT NULL,
    position INTEGER NOT NULL,
    key TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB,
    PRIMARY KEY (slot, position)
  );
`;

// mail.db is only read once more, by legacy-outbox.ts: the mail cache, then the outbox and draft attachments,
// moved to the core's store. Mail is synced again there.
const DROP_CACHE = `
  DROP TABLE mailboxes;
  DROP TABLE messages;
  DROP TABLE sync_state;
  DROP TABLE bodies;
  DROP TABLE thread_ids;
  DROP TABLE thread_subjects;
  DROP TABLE addresses;
`;

export const MIGRATIONS = [SCHEMA, DROP_CACHE];

export const database = lazyDatabase('mail.db', MIGRATIONS);
