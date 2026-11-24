import type { MessageSummary } from '@/core';
import { addOlder, applySync, conversationsSql, deleteAccountData, getKnown, removeMessages, storedAccounts, getBlockedCount, getBody, getSyncState, getThreads, pageConversations, pageMessages, putMessages, saveBody } from '@/mail/db';
import { MIGRATIONS } from '@/mail/database';
import { migrate } from '@/db/migrate';
import type { MailboxRef } from '@/mail/refs';
import * as SQLite from 'expo-sqlite';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const summary = (uid: number, date: number, seen = false): MessageSummary => ({
  uid,
  flags: { seen, flagged: false, answered: false, draft: false, deleted: false },
  subject: `Message ${uid}`,
  from: [{ email: 'sender@example.com' }],
  to: [],
  cc: [],
  replyTo: [],
  deliveredTo: [],
  date,
  references: [],
  preview: '',
  hasAttachments: false,
  size: 10,
});

const state = { uidValidity: 1, uidNext: 10, highestModseq: 5n };
const inbox = { account: 'a', mailbox: 'INBOX' };
const archive = { account: 'a', mailbox: 'Archive' };
const other = { account: 'b', mailbox: 'INBOX' };

const uids = async (box: MailboxRef) => (await pageMessages([box], undefined, 50)).map((item) => item.uid);

describe('applySync', () => {
  it('stores the first sync and its state', async () => {
    await applySync(inbox, {
      state,
      reset: true,
      changed: [summary(3, 300), summary(2, 200), summary(1, 100)],
      vanished: [],
      truncated: false,
    });
    expect(await uids(inbox)).toEqual([3, 2, 1]);
    expect(await getSyncState(inbox)).toEqual(state);
  });

  it('updates changed flags, adds new mail and removes vanished messages with their bodies', async () => {
    await saveBody(
      { ...inbox, uidValidity: 1, uid: 1 },
      { uid: 1, text: 'hi', hasRemoteContent: false, blockedRemote: 0, attachments: [], listUnsubscribe: [], listUnsubscribeOneClick: false },
      false,
    );
    await applySync(inbox, {
      state: { ...state, uidNext: 11, highestModseq: 6n },
      reset: false,
      changed: [summary(4, 400), summary(2, 200, true)],
      vanished: [1],
      truncated: false,
    });
    const items = await pageMessages([inbox], undefined, 50);
    expect(items.map((item) => item.uid)).toEqual([4, 3, 2]);
    expect(items.find((item) => item.uid === 2)?.summary.flags.seen).toBe(true);
    expect(await getBody({ ...inbox, uidValidity: 1, uid: 1 }, false)).toBeNull();
    expect((await getSyncState(inbox))?.highestModseq).toBe(6n);
  });

  it('drops only the mailbox that was reset', async () => {
    await applySync(archive, { state, reset: true, changed: [summary(9, 50)], vanished: [], truncated: false });
    await applySync(inbox, { state: { ...state, uidValidity: 2 }, reset: true, changed: [summary(1, 500)], vanished: [], truncated: false });
    expect(await uids(inbox)).toEqual([1]);
    expect(await uids(archive)).toEqual([9]);
  });

  it('keeps a reused UID separate from stale actions and pending cache writes', async () => {
    const box = { account: 'rebuilt', mailbox: 'INBOX' };
    const previous = { ...box, uid: 1, uidValidity: 1 };
    const current = { ...previous, uidValidity: 2 };
    const body = { uid: 1, text: 'old message', hasRemoteContent: false, blockedRemote: 0, attachments: [], listUnsubscribe: [], listUnsubscribeOneClick: false };
    const initial = { state, reset: true, changed: [summary(1, 100)], vanished: [], truncated: false };
    await applySync(box, initial);
    await applySync(box, { ...initial, state: { ...state, uidValidity: 2 }, changed: [summary(1, 200)] });

    await removeMessages([previous]);
    await putMessages([{ ...previous, summary: summary(1, 100) }]);
    await addOlder(previous, [summary(2, 50)]);
    await saveBody(previous, body, false);
    await applySync(box, initial);

    expect(await pageMessages([box], undefined, 10)).toEqual([
      expect.objectContaining({ uid: 1, uidValidity: 2, summary: summary(1, 200) }),
    ]);
    expect(await getBody(previous, false)).toBeNull();
    expect(await getBody(current, false)).toBeNull();
  });
});

describe('getBlockedCount', () => {
  it('keeps the count of the body last read, and nothing for an unopened message', async () => {
    const ref = { ...inbox, uidValidity: 2, uid: 1 };
    expect(await getBlockedCount(ref)).toBeNull();
    await saveBody(ref, { uid: 1, html: '<p>x</p>', hasRemoteContent: true, blockedRemote: 3, attachments: [], listUnsubscribe: [], listUnsubscribeOneClick: false }, false);
    expect(await getBlockedCount(ref)).toBe(3);
    await saveBody(ref, { uid: 1, html: '<p>x</p>', hasRemoteContent: true, blockedRemote: 0, attachments: [], listUnsubscribe: [], listUnsubscribeOneClick: false }, true);
    expect(await getBlockedCount(ref)).toBe(0);
  });
});

describe('pageMessages', () => {
  it('merges mailboxes newest first and continues after a cursor', async () => {
    await applySync(other, { state, reset: true, changed: [summary(7, 450), summary(6, 50)], vanished: [], truncated: false });
    const first = await pageMessages([inbox, other], undefined, 2);
    expect(first.map((item) => [item.account, item.uid])).toEqual([
      ['a', 1],
      ['b', 7],
    ]);
    const last = first[first.length - 1];
    const next = await pageMessages([inbox, other], { date: last.summary.date, account: last.account, uid: last.uid }, 2);
    expect(next.map((item) => [item.account, item.uid])).toEqual([['b', 6]]);
  });
});

describe('pageConversations', () => {
  const sent = { account: 'b', mailbox: 'Sent' };
  const said = (uid: number, date: number, id: string, references: string[] = []) => ({
    ...summary(uid, date),
    messageId: id,
    references,
  });

  it('shows a conversation once, as its newest message in the mailbox, with your Sent reply in it', async () => {
    await applySync(other, {
      state,
      reset: false,
      changed: [said(20, 900, 'plan-2', ['plan-1']), said(10, 700, 'plan-1')],
      vanished: [],
      truncated: false,
    });
    await applySync(sent, { state, reset: true, changed: [said(1, 800, 'mine', ['plan-1'])], vanished: [], truncated: false });
    const [row, ...rest] = await pageConversations([other], undefined, 50);
    expect(row.uid).toBe(20);
    expect(rest.map((item) => item.uid)).toEqual([7, 6]);
    const members = await getThreads([row]);
    expect(members.map((item) => [item.mailbox, item.uid]).sort()).toEqual([
      ['INBOX', 10],
      ['INBOX', 20],
      ['Sent', 1],
    ]);
  });

  it('groups the unified inbox per account, even when both accounts got the same message', async () => {
    await putMessages([
      { ...inbox, uidValidity: 2, uid: 30, summary: said(30, 1000, 'shared') },
      { ...other, uidValidity: 1, uid: 30, summary: said(30, 1000, 'shared') },
    ]);
    const rows = await pageConversations([inbox, other], undefined, 2);
    expect(rows.map((item) => [item.account, item.uid])).toEqual([
      ['b', 30],
      ['a', 30],
    ]);
    const last = rows[rows.length - 1];
    const next = await pageConversations([inbox, other], { date: last.summary.date, account: last.account, uid: last.uid }, 2);
    expect(next.map((item) => [item.account, item.uid])).toEqual([
      ['b', 20],
      ['a', 1],
    ]);
  });
});

describe('a sync that left new mail out', () => {
  const box = { account: 'gap', mailbox: 'INBOX', uidValidity: 1 };

  it('lists from the newest mail down to the gap, and again past it once paging has fetched through', async () => {
    await applySync(box, {
      state: { uidValidity: 1, uidNext: 4 },
      reset: true,
      changed: [summary(3, 300), summary(2, 200), summary(1, 100)],
      vanished: [],
      truncated: false,
    });
    await applySync(box, {
      state: { uidValidity: 1, uidNext: 104 },
      reset: false,
      changed: [summary(103, 10300), summary(102, 10200), summary(2, 200, true)],
      vanished: [],
      truncated: true,
    });
    // 4 to 101 are on the server only, so 3, 2 and 1 would follow 102 with nothing to show for the gap.
    expect(await uids(box)).toEqual([103, 102]);
    expect((await getKnown(box)).map((known) => known.uid).sort((a, b) => a - b)).toEqual([1, 2, 3, 102, 103]);
    expect((await getKnown(box)).find((known) => known.uid === 2)?.flags.seen).toBe(true);

    await addOlder(box, [summary(101, 10100), summary(4, 400)]);
    await addOlder(box, [summary(3, 300)]);
    expect(await uids(box)).toEqual([103, 102, 101, 4, 3]);
  });
});

describe('a conversation whose messages are all gone', () => {
  const box = { account: 'threads', mailbox: 'INBOX', uidValidity: 1 };
  const state = { uidValidity: 1, uidNext: 10 };
  const said = (uid: number, date: number, id: string, references: string[] = []) => ({
    ...summary(uid, date),
    messageId: id,
    references,
  });

  it('is forgotten, and a conversation that lost one message still takes its replies', async () => {
    await applySync(box, {
      state,
      reset: true,
      changed: [said(3, 300, 'kept-2', ['kept-1']), said(2, 200, 'kept-1'), said(1, 100, 'gone-1')],
      vanished: [],
      truncated: false,
    });
    await removeMessages([{ ...box, uid: 1 }, { ...box, uid: 2 }]);
    await applySync(box, { state, reset: false, changed: [said(4, 400, 'kept-3', ['kept-1', 'kept-2'])], vanished: [], truncated: false });

    const [row, ...rest] = await pageConversations([box], undefined, 50);
    expect(rest).toEqual([]);
    expect((await getThreads([row])).map((item) => item.uid).sort()).toEqual([3, 4]);
  });
});

describe('the data of an account', () => {
  it('is listed while any of it is left, and goes with deleteAccountData', async () => {
    const box = { account: 'leaving', mailbox: 'INBOX' };
    await applySync(box, { state: { uidValidity: 1, uidNext: 2 }, reset: true, changed: [summary(1, 100)], vanished: [], truncated: false });
    expect(await storedAccounts()).toContain('leaving');

    await deleteAccountData('leaving');
    expect(await storedAccounts()).not.toContain('leaving');
  });
});

describe('the conversations query', () => {
  it('walks the date index and looks up each conversation, without sorting or ranking the mailbox', async () => {
    const db = await SQLite.openDatabaseAsync('plan.db');
    await migrate(db, 'mail', MIGRATIONS);
    const plan = await db.getAllAsync<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${conversationsSql([inbox], true, false)}`,
      ['a', 'INBOX', 'a', 'INBOX', 0, 'a', 0, 50],
    );
    const steps = plan.map((row) => row.detail).join('\n');
    expect(steps).toContain('messages_by_date');
    expect(steps).toContain('messages_by_thread');
    expect(steps).not.toContain('TEMP B-TREE');
  });
});
