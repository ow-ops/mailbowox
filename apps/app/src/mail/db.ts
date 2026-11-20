import type * as SQLite from 'expo-sqlite';

import type {
  Address,
  KnownMessage,
  Mailbox,
  MailboxRole,
  MessageBody,
  MessageSummary,
  SyncResult,
  SyncState,
} from '@/core';

import { database, nowSeconds, transaction } from './database';
import type { MailboxGeneration, MailboxRef, MailItem, MessageRef, StoredItem } from './refs';
import { matchesQuery, searchText, type SearchQuery } from './search';
import { assignThreads, baseSubject, threadIds, type ThreadIndex } from './threads';

export type Cursor = { date: number; account: string; uid: number };

const listed = (alias: string) => `${alias}.uid >= COALESCE(
  (SELECT floor FROM sync_state s WHERE s.account = ${alias}.account AND s.mailbox = ${alias}.mailbox), 0)`;

const LISTED = listed('messages');

const BODY_CACHE_BYTES = 50 * 1024 * 1024;

export async function saveMailboxes(account: string, mailboxes: Mailbox[]) {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM mailboxes WHERE account = ?', account);
    for (const [position, mailbox] of mailboxes.entries()) {
      await db.runAsync(
        'INSERT INTO mailboxes (account, name, position, mailbox) VALUES (?, ?, ?, ?)',
        account,
        mailbox.name,
        position,
        JSON.stringify(mailbox),
      );
    }
  });
}

export async function getMailboxes(account: string): Promise<Mailbox[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ mailbox: string }>(
    'SELECT mailbox FROM mailboxes WHERE account = ? ORDER BY position',
    account,
  );
  return rows.map((row) => JSON.parse(row.mailbox) as Mailbox);
}

export async function roleMailbox(account: string, role: MailboxRole) {
  return (await getMailboxes(account)).find((m) => m.role === role)?.name;
}

export async function getUnreadCounts(account: string) {
  const db = await database();
  const rows = await db.getAllAsync<{ mailbox: string; unread: number }>(
    `SELECT mailbox, COUNT(*) AS unread FROM messages WHERE account = ? AND seen = 0 AND ${LISTED} GROUP BY mailbox`,
    account,
  );
  return Object.fromEntries(rows.map((row) => [row.mailbox, row.unread]));
}

export async function getSyncState({ account, mailbox }: MailboxRef): Promise<SyncState | undefined> {
  const db = await database();
  const row = await db.getFirstAsync<{ uid_validity: number; uid_next: number; highest_modseq: string | null }>(
    'SELECT uid_validity, uid_next, highest_modseq FROM sync_state WHERE account = ? AND mailbox = ?',
    account,
    mailbox,
  );
  if (!row) return undefined;
  return {
    uidValidity: row.uid_validity,
    uidNext: row.uid_next,
    highestModseq: row.highest_modseq === null ? undefined : BigInt(row.highest_modseq),
  };
}

// Every cached message of the mailbox, listed or not, for the core to compare with the server.
export async function getKnown({ account, mailbox, uidValidity }: MailboxGeneration): Promise<KnownMessage[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ uid: number; flags: string }>(
    "SELECT uid, json_extract(summary, '$.flags') AS flags FROM messages WHERE account = ? AND mailbox = ? AND uid_validity = ?",
    account,
    mailbox,
    uidValidity,
  );
  return rows.map((row) => ({ uid: row.uid, flags: JSON.parse(row.flags) as KnownMessage['flags'] }));
}

async function loadThreadIndex(db: SQLite.SQLiteDatabase, account: string, summaries: MessageSummary[]) {
  const ids = summaries.flatMap(threadIds);
  const subjects = summaries.map((s) => baseSubject(s.subject));
  const [idRows, subjectRows] = await Promise.all([
    db.getAllAsync<{ key: string; thread: string }>(
      'SELECT message_id AS key, thread FROM thread_ids WHERE account = ? AND message_id IN (SELECT value FROM json_each(?))',
      account,
      JSON.stringify(ids),
    ),
    db.getAllAsync<{ key: string; thread: string }>(
      'SELECT subject AS key, thread FROM thread_subjects WHERE account = ? AND subject IN (SELECT value FROM json_each(?))',
      account,
      JSON.stringify(subjects),
    ),
  ]);
  const toMap = (rows: { key: string; thread: string }[]) => new Map(rows.map((row) => [row.key, row.thread]));
  return { ids: toMap(idRows), subjects: toMap(subjectRows) };
}

async function saveThreadIndex(
  db: SQLite.SQLiteDatabase,
  account: string,
  index: ThreadIndex,
  merges: (readonly [string, string])[],
) {
  for (const [from, into] of merges) {
    for (const table of ['messages', 'thread_ids', 'thread_subjects']) {
      await db.runAsync(`UPDATE ${table} SET thread = ? WHERE account = ? AND thread = ?`, into, account, from);
    }
  }
  for (const [id, thread] of index.ids) {
    await db.runAsync(
      'INSERT OR REPLACE INTO thread_ids (account, message_id, thread) VALUES (?, ?, ?)',
      account,
      id,
      thread,
    );
  }
  for (const [subject, thread] of index.subjects) {
    await db.runAsync(
      'INSERT OR REPLACE INTO thread_subjects (account, subject, thread) VALUES (?, ?, ?)',
      account,
      subject,
      thread,
    );
  }
}

async function noteAddresses(db: SQLite.SQLiteDatabase, account: string, { from, to, cc, date }: MessageSummary) {
  for (const { name, email } of [...from, ...to, ...cc]) {
    await db.runAsync(
      `INSERT INTO addresses (account, email, name, seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (account, email) DO UPDATE SET
         name = CASE WHEN excluded.seen_at >= seen_at AND excluded.name IS NOT NULL THEN excluded.name ELSE name END,
         seen_at = MAX(seen_at, excluded.seen_at)`,
      account,
      email.toLowerCase(),
      name || null,
      date,
    );
  }
}

// Every write goes through here so each message gets its conversation id as it lands.
async function upsert(db: SQLite.SQLiteDatabase, account: string, items: MailItem[]) {
  if (items.length === 0) return;
  const index = await loadThreadIndex(db, account, items.map((item) => item.summary));
  const { threads, merges } = assignThreads(
    index,
    items.map((item) => ({ summary: item.summary, fallback: `${item.mailbox}\n${item.uid}` })),
  );
  await saveThreadIndex(db, account, index, merges);
  for (const [i, { mailbox, uidValidity, summary }] of items.entries()) {
    await db.runAsync(
      'INSERT OR REPLACE INTO messages (account, mailbox, uid, date, seen, flagged, summary, thread, search, uid_validity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      account,
      mailbox,
      summary.uid,
      summary.date,
      summary.flags.seen ? 1 : 0,
      summary.flags.flagged ? 1 : 0,
      JSON.stringify(summary),
      threads[i],
      searchText(summary),
      uidValidity,
    );
    await noteAddresses(db, account, summary);
  }
}

// A conversation with no message left has no use for its ids and subject. One that arrives again starts
// from its own ids, as it did the first time.
async function forgetEmptyThreads(db: SQLite.SQLiteDatabase, account: string) {
  for (const table of ['thread_ids', 'thread_subjects']) {
    await db.runAsync(
      `DELETE FROM ${table} WHERE account = ? AND thread NOT IN (SELECT thread FROM messages WHERE account = ?)`,
      account,
      account,
    );
  }
}

const MESSAGE = 'account = ? AND mailbox = ? AND uid = ? AND uid_validity = ?';
const messageArgs = ({ account, mailbox, uid, uidValidity }: MessageRef) => [account, mailbox, uid, uidValidity] as const;

async function remove(db: SQLite.SQLiteDatabase, ref: MessageRef) {
  await db.runAsync(`DELETE FROM messages WHERE ${MESSAGE}`, ...messageArgs(ref));
  await db.runAsync(`DELETE FROM bodies WHERE ${MESSAGE}`, ...messageArgs(ref));
}

async function clearMailbox(db: SQLite.SQLiteDatabase, { account, mailbox }: MailboxRef) {
  for (const table of ['messages', 'bodies', 'sync_state']) {
    await db.runAsync(`DELETE FROM ${table} WHERE account = ? AND mailbox = ?`, account, mailbox);
  }
  await forgetEmptyThreads(db, account);
}

async function cachedGeneration(db: SQLite.SQLiteDatabase, { account, mailbox }: MailboxRef) {
  const row = await db.getFirstAsync<{ uid_validity: number | null }>(
    `SELECT COALESCE(
      (SELECT uid_validity FROM sync_state WHERE account = ?1 AND mailbox = ?2),
      (SELECT uid_validity FROM messages WHERE account = ?1 AND mailbox = ?2 LIMIT 1)
    ) AS uid_validity`,
    account, mailbox,
  );
  return row?.uid_validity ?? undefined;
}

// The list is every cached message from `floor` up, so it never shows two stretches of a mailbox with unseen
// mail between them. A reset starts it over. So does a sync that left new mail out: the floor rises to the
// oldest message it did bring, and paging down fetches through the gap to the older messages still cached.
export async function applySync(box: MailboxRef, result: SyncResult) {
  await transaction(async (db) => {
    const stored = await db.getFirstAsync<{ floor: number; uid_next: number; uid_validity: number }>(
      'SELECT floor, uid_next, uid_validity FROM sync_state WHERE account = ? AND mailbox = ?',
      box.account,
      box.mailbox,
    );
    const { uidValidity } = result.state;
    const previous = stored?.uid_validity ?? await cachedGeneration(db, box);
    if (previous !== undefined && previous > uidValidity) return;
    const reset = result.reset || (previous !== undefined && previous !== uidValidity);
    const generation = { ...box, uidValidity };
    const uids = result.changed.map((summary) => summary.uid);
    let floor = stored?.floor ?? 0;
    if (reset || !stored) floor = Math.min(result.state.uidNext, ...uids);
    else if (result.truncated) floor = Math.min(result.state.uidNext, ...uids.filter((uid) => uid >= stored.uid_next));
    if (reset) await clearMailbox(db, box);
    for (const uid of result.vanished) await remove(db, { ...generation, uid });
    await upsert(db, box.account, result.changed.map((summary) => ({ ...generation, uid: summary.uid, summary })));
    if (result.vanished.length > 0) await forgetEmptyThreads(db, box.account);
    await db.runAsync(
      'INSERT OR REPLACE INTO sync_state (account, mailbox, uid_validity, uid_next, highest_modseq, floor) VALUES (?, ?, ?, ?, ?, ?)',
      box.account,
      box.mailbox,
      result.state.uidValidity,
      result.state.uidNext,
      result.state.highestModseq?.toString() ?? null,
      floor,
    );
  });
}

export async function putMessages(items: MailItem[]) {
  await transaction(async (db) => {
    const boxes = new Map<string, MailItem[]>();
    for (const item of items) {
      const key = JSON.stringify([item.account, item.mailbox]);
      const box = boxes.get(key);
      if (box) box.push(item);
      else boxes.set(key, [item]);
    }
    for (const messages of boxes.values()) {
      const box = messages[0];
      const newest = Math.max(...messages.map((item) => item.uidValidity));
      const previous = await cachedGeneration(db, box);
      if (previous !== undefined && previous > newest) continue;
      if (previous !== undefined && previous < newest) await clearMailbox(db, box);
      await upsert(db, box.account, messages.filter((item) => item.uidValidity === newest));
    }
  });
}

// Older messages the list paged down to, which lowers the mailbox's floor to them.
export async function addOlder(box: MailboxGeneration, summaries: MessageSummary[]) {
  if (summaries.length === 0) return;
  await transaction(async (db) => {
    if (await cachedGeneration(db, box) !== box.uidValidity) return;
    await upsert(db, box.account, summaries.map((summary) => ({ ...box, uid: summary.uid, summary })));
    await db.runAsync(
      'UPDATE sync_state SET floor = MIN(floor, ?) WHERE account = ? AND mailbox = ?',
      Math.min(...summaries.map((summary) => summary.uid)),
      box.account,
      box.mailbox,
    );
  });
}

export async function removeMessages(refs: MessageRef[]) {
  await transaction(async (db) => {
    for (const ref of refs) await remove(db, ref);
    for (const account of new Set(refs.map((ref) => ref.account))) await forgetEmptyThreads(db, account);
  });
}

type MessageRow = { account: string; mailbox: string; uid: number; uid_validity: number; thread: string; summary: string };

const COLUMNS = 'account, mailbox, uid, uid_validity, thread, summary';

const toItem = ({ uid_validity, summary, ...row }: MessageRow): StoredItem =>
  ({ ...row, uidValidity: uid_validity, summary: JSON.parse(summary) as MessageSummary });

const inBoxes = (boxes: MailboxRef[], alias = 'messages') =>
  boxes.map(() => `(${alias}.account = ? AND ${alias}.mailbox = ?)`).join(' OR ');

const pageParams = (boxes: MailboxRef[], before: Cursor | undefined, limit: number) => [
  ...boxes.flatMap((b) => [b.account, b.mailbox]),
  ...(before ? [before.date, before.account, before.uid] : []),
  limit,
];

// A page across accounts is each account's own page, merged: one account's mailbox comes off its date
// index already in order, where sorting several accounts' mailboxes together reads all of them.
async function pageEachAccount(boxes: MailboxRef[], limit: number, page: (boxes: MailboxRef[]) => Promise<MessageRow[]>) {
  const accounts = [...new Set(boxes.map((box) => box.account))];
  const pages = await Promise.all(accounts.map((account) => page(boxes.filter((box) => box.account === account))));
  if (pages.length === 1) return pages[0].map(toItem);
  const newestFirst = (a: StoredItem, b: StoredItem) =>
    b.summary.date - a.summary.date || (a.account < b.account ? 1 : a.account > b.account ? -1 : b.uid - a.uid);
  return pages.flat().map(toItem).sort(newestFirst).slice(0, limit);
}

// Newest first across every given mailbox; `before` continues after the last item of the previous page.
export async function pageMessages(boxes: MailboxRef[], before: Cursor | undefined, limit: number, unread = false) {
  const db = await database();
  return pageEachAccount(boxes, limit, (own) =>
    db.getAllAsync<MessageRow>(
      `SELECT ${COLUMNS} FROM messages
       WHERE (${inBoxes(own)}) AND ${LISTED} ${unread ? 'AND seen = 0' : ''} ${before ? 'AND (date, account, uid) < (?, ?, ?)' : ''}
       ORDER BY date DESC, account DESC, uid DESC LIMIT ?`,
      pageParams(own, before, limit),
    ),
  );
}

// One row per conversation: the message that no other of its conversation, among those listed in these
// mailboxes, is newer than. The rows come off the date index and each looks its conversation up, so a page
// reads about a page of messages, where ranking every conversation first read the whole mailbox. The lookup
// names its index: left to choose, SQLite scans the mailbox's newer messages for each row.
export function conversationsSql(boxes: MailboxRef[], before: boolean, unread: boolean) {
  const shown = (alias: string) => `(${inBoxes(boxes, alias)}) AND ${listed(alias)} ${unread ? `AND ${alias}.seen = 0` : ''}`;
  return `SELECT ${COLUMNS.split(', ').map((column) => `m.${column}`).join(', ')} FROM messages m
     WHERE ${shown('m')}
       AND NOT EXISTS (
         SELECT 1 FROM messages n INDEXED BY messages_by_thread
         WHERE n.account = m.account AND n.thread = m.thread AND ${shown('n')}
           AND (n.date, n.uid, n.mailbox) > (m.date, m.uid, m.mailbox)
       )
       ${before ? 'AND (m.date, m.account, m.uid) < (?, ?, ?)' : ''}
     ORDER BY m.date DESC, m.account DESC, m.uid DESC LIMIT ?`;
}

// Like pageMessages, with one item per conversation: its newest message in the given mailboxes.
export async function pageConversations(
  boxes: MailboxRef[],
  before: Cursor | undefined,
  limit: number,
  unread = false,
) {
  const db = await database();
  return pageEachAccount(boxes, limit, (own) =>
    db.getAllAsync<MessageRow>(conversationsSql(own, !!before, unread), [
      ...own.flatMap((b) => [b.account, b.mailbox]),
      ...pageParams(own, before, limit),
    ]),
  );
}

export async function getThreads(threads: { account: string; thread: string }[]) {
  const db = await database();
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT ${COLUMNS} FROM messages WHERE (account, thread) IN (
       SELECT json_extract(value, '$.account'), json_extract(value, '$.thread') FROM json_each(?)
     )`,
    JSON.stringify(threads.map(({ account, thread }) => ({ account, thread }))),
  );
  return rows.map(toItem);
}

// How many messages that mention a field's value are checked against the field itself. Far above any page
// of results, and still a bound on what one keystroke reads.
const FIELD_CANDIDATES = 5000;

// Newest first, listed or not. The search column holds every field a query can name, so a from: or subject:
// value only narrows in SQL and is then checked against its own field. That check comes before the limit:
// counting the loose matches first could fill it with messages that merely mention the value.
export async function searchMessages(boxes: MailboxRef[], query: SearchQuery, limit: number) {
  const db = await database();
  const terms = [...query.words, ...query.fields.map(({ value }) => value)];
  const conditions = [
    ...terms.map(() => 'instr(search, ?) > 0'),
    ...(query.seen === undefined ? [] : [`seen = ${query.seen ? 1 : 0}`]),
    ...(query.flagged ? ['flagged = 1'] : []),
    ...(query.attachments ? ["json_extract(summary, '$.hasAttachments')"] : []),
  ];
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT ${COLUMNS} FROM messages
     WHERE (${inBoxes(boxes)}) ${conditions.map((condition) => `AND ${condition}`).join(' ')}
     ORDER BY date DESC, uid DESC LIMIT ?`,
    [...boxes.flatMap((b) => [b.account, b.mailbox]), ...terms, query.fields.length > 0 ? FIELD_CANDIDATES : limit],
  );
  return rows
    .map(toItem)
    .filter((item) => matchesQuery(item.summary, query))
    .slice(0, limit);
}

export async function getMessages(refs: MessageRef[]) {
  const db = await database();
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT ${COLUMNS} FROM messages WHERE (account, mailbox, uid, uid_validity) IN (
       SELECT json_extract(value, '$.account'), json_extract(value, '$.mailbox'), json_extract(value, '$.uid'), json_extract(value, '$.uidValidity')
       FROM json_each(?)
     )`,
    JSON.stringify(refs),
  );
  return rows.map(toItem);
}

export async function getThreadItems({ account, mailbox, uidValidity }: MailboxGeneration, thread: string) {
  const db = await database();
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT ${COLUMNS} FROM messages WHERE account = ? AND mailbox = ? AND uid_validity = ? AND thread = ?`,
    account,
    mailbox,
    uidValidity,
    thread,
  );
  return rows.map(toItem);
}

export async function getMessage(ref: MessageRef) {
  const db = await database();
  const row = await db.getFirstAsync<MessageRow>(
    `SELECT ${COLUMNS} FROM messages WHERE ${MESSAGE}`,
    ...messageArgs(ref),
  );
  return row ? toItem(row) : null;
}

export async function oldest({ account, mailbox }: MailboxRef) {
  const db = await database();
  const row = await db.getFirstAsync<{ uid: number; date: number; uid_validity: number }>(
    `SELECT MIN(uid) AS uid, MIN(date) AS date, uid_validity
     FROM messages WHERE account = ? AND mailbox = ? AND ${LISTED} GROUP BY uid_validity`,
    account,
    mailbox,
  );
  return row ? { uid: row.uid, date: row.date, uidValidity: row.uid_validity } : null;
}

// A body fetched without remote content does not answer a request that allows it.
export async function getBody(ref: MessageRef, allowRemote: boolean) {
  const db = await database();
  const row = await db.getFirstAsync<{ remote: number; body: string }>(
    `SELECT remote, body FROM bodies WHERE ${MESSAGE}`,
    ...messageArgs(ref),
  );
  if (!row || (allowRemote && !row.remote)) return null;
  await transaction(async (queued) => {
    await queued.runAsync(
      `UPDATE bodies SET opened_at = ? WHERE ${MESSAGE}`,
      nowSeconds(),
      ...messageArgs(ref),
    );
  });
  return JSON.parse(row.body) as MessageBody;
}

// Keeps the most recently opened bodies up to BODY_CACHE_BYTES, and always the latest one, even when it alone
// is over the limit. Flagged messages keep theirs and do not count.
async function evictBodies(db: SQLite.SQLiteDatabase) {
  await db.runAsync(
    `DELETE FROM bodies WHERE rowid IN (
       SELECT rowid FROM (
         SELECT b.rowid AS rowid, SUM(b.size) OVER newest AS total, ROW_NUMBER() OVER newest AS position
         FROM bodies b
         WHERE NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.account = b.account AND m.mailbox = b.mailbox AND m.uid = b.uid AND m.flagged = 1
         )
         WINDOW newest AS (ORDER BY b.opened_at DESC, b.rowid DESC)
       ) WHERE total > ? AND position > 1
     )`,
    BODY_CACHE_BYTES,
  );
}

export async function saveBody(ref: MessageRef, body: MessageBody, allowRemote: boolean) {
  await transaction(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO bodies (account, mailbox, uid, uid_validity, remote, blocked, body, size, opened_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, length(CAST(?7 AS BLOB)), ?8
         WHERE EXISTS (SELECT 1 FROM messages WHERE account = ?1 AND mailbox = ?2 AND uid = ?3 AND uid_validity = ?4)`,
      ...messageArgs(ref),
      allowRemote ? 1 : 0,
      body.blockedRemote,
      JSON.stringify(body),
      nowSeconds(),
    );
    await evictBodies(db);
  });
}

// Null until the message has been opened.
export async function getBlockedCount(ref: MessageRef) {
  const db = await database();
  const row = await db.getFirstAsync<{ blocked: number }>(
    `SELECT blocked FROM bodies WHERE ${MESSAGE}`,
    ...messageArgs(ref),
  );
  return row?.blocked ?? null;
}

// Newest first: the address of anyone who wrote or was written to, across every account.
export async function getSeenAddresses(): Promise<Address[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ name: string | null; email: string }>(
    'SELECT name, email FROM addresses GROUP BY email ORDER BY MAX(seen_at) DESC LIMIT 5000',
  );
  return rows.map(({ name, email }) => (name ? { name, email } : { email }));
}

// Every account that has anything stored, for finding what a removed account left behind.
export async function storedAccounts() {
  const db = await database();
  const rows = await db.getAllAsync<{ account: string }>(
    'SELECT account FROM mailboxes UNION SELECT account FROM messages UNION SELECT account FROM sync_state UNION SELECT account FROM outbox',
  );
  return rows.map((row) => row.account);
}

export async function deleteAccountData(account: string) {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM outbox WHERE account = ?', account);
    for (const table of ['mailboxes', 'messages', 'sync_state', 'bodies', 'thread_ids', 'thread_subjects', 'addresses']) {
      await db.runAsync(`DELETE FROM ${table} WHERE account = ?`, account);
    }
  });
}
