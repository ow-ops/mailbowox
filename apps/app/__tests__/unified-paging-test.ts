import type { MessageSummary } from '@/core';
import { applySync, pageConversations, pageMessages, type Cursor } from '@/mail/db';
import type { MailboxRef, MessageRef, StoredItem } from '@/mail/refs';
import { loadPage } from '@/mail/paging';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const summary = (uid: number, date: number, thread?: string): MessageSummary => ({
  uid,
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
  subject: `Message ${uid}`,
  from: [{ email: 'sender@example.com' }],
  to: [],
  cc: [],
  replyTo: [],
  deliveredTo: [],
  date,
  messageId: `${thread ?? 'm'}-${uid}-${date}`,
  references: thread ? [thread] : [],
  preview: '',
  hasAttachments: false,
  size: 10,
});

// Two accounts whose mail interleaves; the server holds 30 messages each, and sync stored the newest 5.
// `thread` groups some of alice's messages into conversations.
async function seed(alice: MailboxRef, bob: MailboxRef, thread?: (uid: number) => string | undefined) {
  const server = new Map<string, MessageSummary[]>();
  for (const [box, offset] of [
    [alice, 0],
    [bob, 5],
  ] as const) {
    const all = Array.from({ length: 30 }, (_, i) =>
      summary(30 - i, (30 - i) * 10 + offset, box === alice ? thread?.(30 - i) : undefined),
    );
    server.set(box.account, all);
    await applySync(box, {
      state: { uidValidity: 1, uidNext: 31 },
      reset: true,
      changed: all.slice(0, 5),
      vanished: [],
      truncated: false,
    });
  }
  // Two at a time, so a page needs several fetches.
  return async ({ account, uid }: MessageRef) =>
    (server.get(account) ?? []).filter((s) => s.uid < uid).slice(0, 2);
}

async function pageAll(boxes: MailboxRef[], page: typeof pageMessages, fetchOlder: Awaited<ReturnType<typeof seed>>) {
  const limit = 6;
  const pages: StoredItem[][] = [];
  let cursor: Cursor | undefined;
  for (;;) {
    const items = await loadPage(boxes, cursor, page, limit, fetchOlder);
    pages.push(items);
    const last = items.at(-1);
    if (!last || items.length < limit) return pages;
    cursor = { date: last.summary.date, account: last.account, uid: last.uid };
  }
}

describe('loadPage after a sync that left new mail out', () => {
  it('fetches through the gap and on to the older mail, from a first page shorter than a full one', async () => {
    const box = { account: 'gap', mailbox: 'INBOX' };
    const server = Array.from({ length: 12 }, (_, i) => summary(12 - i, (12 - i) * 10));
    const state = { uidValidity: 1, uidNext: 4 };
    await applySync(box, { state, reset: true, changed: server.slice(9), vanished: [], truncated: false });
    // Nine more arrived and the sync brought the newest two: 4 to 10 are on the server only.
    await applySync(box, {
      state: { ...state, uidNext: 13 },
      reset: false,
      changed: server.slice(0, 2),
      vanished: [],
      truncated: true,
    });
    const fetchOlder = async ({ uid }: MessageRef) => server.filter((s) => s.uid < uid).slice(0, 3);

    const uids: number[] = [];
    let cursor: Cursor | undefined;
    for (;;) {
      const items = await loadPage([box], cursor, pageMessages, 6, fetchOlder);
      const last = items.at(-1);
      if (!last) break;
      uids.push(...items.map((item) => item.uid));
      cursor = { date: last.summary.date, account: last.account, uid: last.uid };
    }
    expect(uids).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe('loadPage with two accounts', () => {
  it('pages every message of both accounts once, newest first', async () => {
    const alice = { account: 'alice', mailbox: 'INBOX' };
    const bob = { account: 'bob', mailbox: 'INBOX' };
    const fetchOlder = await seed(alice, bob);
    const pages = await pageAll([alice, bob], pageMessages, fetchOlder);
    const dates = pages.flat().map((item) => item.summary.date);
    expect(dates).toHaveLength(60);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(pages.slice(0, -1).every((page) => page.length === 6)).toBe(true);
  });

  it('keeps conversations in date order when older mail of one account is mostly one long thread', async () => {
    const alice = { account: 'alice-threads', mailbox: 'INBOX' };
    const bob = { account: 'bob-threads', mailbox: 'INBOX' };
    // Alice's messages 5 to 20 all answer one conversation, so a batch of them adds a single row.
    const fetchOlder = await seed(alice, bob, (uid) => (uid >= 5 && uid <= 20 ? 'long' : undefined));
    const pages = await pageAll([alice, bob], pageConversations, fetchOlder);
    const rows = pages.flat();
    const dates = rows.map((item) => item.summary.date);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(rows.filter((item) => item.account === bob.account)).toHaveLength(30);
    expect(rows.filter((item) => item.account === alice.account)).toHaveLength(30 - 15);
  });
});
