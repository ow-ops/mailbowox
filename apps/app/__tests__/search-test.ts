import type { MessageSummary } from '@/core';
import { addOlder, applySync, oldest, pageMessages, putMessages, searchMessages } from '@/mail/db';
import { type StoredItem } from '@/mail/refs';
import { parseQuery, rankResults } from '@/mail/search';
import { normalize, queryWords } from '@/utils/text';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const summary = (uid: number, date: number, fields: Partial<MessageSummary> = {}): MessageSummary => ({
  uid,
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
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
  ...fields,
});

const state = { uidValidity: 1, uidNext: 100, highestModseq: 5n };
const inbox = { account: 'a', mailbox: 'INBOX', uidValidity: state.uidValidity };
const archive = { account: 'a', mailbox: 'Archive' };

const item = (uid: number, date: number, fields: Partial<MessageSummary> = {}): StoredItem => ({
  ...inbox,
  uid,
  thread: String(uid),
  summary: summary(uid, date, fields),
});

const found = async (query: string, boxes = [inbox, archive]) =>
  (await searchMessages(boxes, parseQuery(query), 50)).map((m) => [m.mailbox, m.uid]);

describe('normalize', () => {
  it('folds case and accents', () => {
    expect(normalize('Élise Ça')).toBe('elise ca');
    expect(queryWords('  Élise   élise RENÉ ')).toEqual(['elise', 'rene']);
  });
});

describe('searchMessages', () => {
  beforeAll(async () => {
    await applySync(inbox, {
      state,
      reset: true,
      changed: [
        summary(52, 520, { subject: 'Invoice for March', from: [{ name: 'Élise Martin', email: 'elise@shop.example' }] }),
        summary(51, 510, { subject: 'Lunch', preview: 'the invoice is attached' }),
        summary(50, 500, { subject: 'Holiday', to: [{ email: 'team@example.com' }] }),
      ],
      vanished: [],
      truncated: false,
    });
    await applySync(archive, {
      state,
      reset: true,
      changed: [summary(9, 90, { subject: 'Old invoice' })],
      vanished: [],
      truncated: false,
    });
  });

  it('finds every word across subject, people and preview, newest first', async () => {
    expect(await found('invoice')).toEqual([
      ['INBOX', 52],
      ['INBOX', 51],
      ['Archive', 9],
    ]);
    expect(await found('elise invoice')).toEqual([['INBOX', 52]]);
    expect(await found('TEAM@example')).toEqual([['INBOX', 50]]);
    expect(await found('invoice holiday')).toEqual([]);
  });

  it('stays in the given mailboxes', async () => {
    expect(await found('invoice', [archive])).toEqual([['Archive', 9]]);
  });

  it('keeps messages found below the list out of it until paging reaches them', async () => {
    await putMessages([{ ...inbox, uid: 3, summary: summary(3, 30, { subject: 'Ancient invoice' }) }]);
    expect(await found('ancient', [inbox])).toEqual([['INBOX', 3]]);
    expect((await pageMessages([inbox], undefined, 50)).map((m) => m.uid)).toEqual([52, 51, 50]);
    expect(await oldest(inbox)).toEqual({ uid: 50, date: 500, uidValidity: 1 });

    await addOlder(inbox, [summary(10, 100), summary(3, 30, { subject: 'Ancient invoice' })]);
    expect((await pageMessages([inbox], undefined, 50)).map((m) => m.uid)).toEqual([52, 51, 50, 10, 3]);
  });
});

describe('search operators', () => {
  const box = { account: 'operators', mailbox: 'INBOX' };
  const flags = { seen: true, flagged: false, answered: false, draft: false, deleted: false };

  beforeAll(() =>
    applySync(box, {
      state,
      reset: true,
      changed: [
        summary(3, 300, { subject: 'Photos', hasAttachments: true, flags: { ...flags, flagged: true } }),
        summary(2, 200, {
          subject: 'Lunch',
          preview: 'the invoice is attached',
          to: [{ email: 'team@example.com' }],
          cc: [{ email: 'boss@example.com' }],
          flags: { ...flags, seen: false },
        }),
        summary(1, 100, { subject: 'Invoice for March', from: [{ name: 'Élise Martin', email: 'elise@shop.example' }] }),
      ],
      vanished: [],
      truncated: false,
    }),
  );

  const search = async (text: string) => {
    const query = parseQuery(text);
    return rankResults(await searchMessages([box], query, 50), query).map((m) => m.uid);
  };

  it('reads fields, flags and has:attachment out of the query, and keeps the rest for the server as typed', () => {
    expect(parseQuery('From:Élise is:unread has:attachment café')).toEqual({
      words: ['cafe'],
      fields: [{ field: 'from', value: 'elise' }],
      seen: false,
      attachments: true,
      server: 'From:Élise is:unread café',
    });
  });

  it('keeps a value to its own field', async () => {
    expect(await search('invoice')).toEqual([1, 2]);
    expect(await search('subject:invoice')).toEqual([1]);
    expect(await search('from:elise')).toEqual([1]);
    expect(await search('from:team')).toEqual([]);
  });

  it('finds a field match however many newer messages only mention the word', async () => {
    const crowded = { account: 'crowded', mailbox: 'INBOX' };
    const mentions = Array.from({ length: 60 }, (_, i) => summary(100 + i, 1000 + i, { subject: 'About elise' }));
    const written = summary(1, 10, { from: [{ name: 'Élise Martin', email: 'elise@shop.example' }] });
    await applySync(crowded, { state, reset: true, changed: [...mentions, written], vanished: [], truncated: false });

    const query = parseQuery('from:elise');
    expect((await searchMessages([crowded], query, 50)).map((m) => m.uid)).toEqual([1]);
  });

  it('looks for to: in Cc as well', async () => {
    expect(await search('to:team')).toEqual([2]);
    expect(await search('to:boss')).toEqual([2]);
    expect(await search('cc:team')).toEqual([]);
  });

  it('filters on read and starred, alone or with words', async () => {
    expect(await search('is:unread')).toEqual([2]);
    expect(await search('is:read')).toEqual([3, 1]);
    expect(await search('is:starred')).toEqual([3]);
    expect(await search('is:read invoice')).toEqual([1]);
  });

  it('keeps only messages with attachments for has:attachment', async () => {
    expect(await search('has:attachment')).toEqual([3]);
    expect(await search('has:attachment invoice')).toEqual([]);
  });
});

describe('rankResults', () => {
  const words = parseQuery('invoice');

  it('puts subject and people matches before preview matches, and body-only server matches last', () => {
    const subject = item(1, 100, { subject: 'Invoice' });
    const preview = item(2, 300, { preview: 'your invoice' });
    const body = item(3, 400, { subject: 'Re: payment' });
    const sender = item(4, 200, { from: [{ name: 'Invoice desk', email: 'billing@example.com' }] });
    expect(rankResults([body, preview, subject, sender], words).map((m) => m.uid)).toEqual([4, 1, 2, 3]);
  });

  it('lists a message once when the cache and the server both found it', () => {
    const message = item(5, 100, { subject: 'Invoice' });
    expect(rankResults([message, { ...message }], words)).toHaveLength(1);
  });
});
