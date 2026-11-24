import type { MessageSummary } from '@/core';
import { type StoredItem } from '@/mail/refs';
import { parseQuery, rankResults, storeQuery } from '@/mail/search';
import { normalize, queryWords } from '@/utils/text';

const flags = { seen: true, flagged: false, answered: false, draft: false, deleted: false };

const item = (uid: number, date: number, fields: Partial<MessageSummary> = {}): StoredItem => ({
  account: 'a',
  mailbox: 'INBOX',
  uidValidity: 1,
  uid,
  thread: String(uid),
  summary: {
    uid,
    flags,
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
  },
});

describe('normalize', () => {
  it('folds case and accents', () => {
    expect(normalize('Élise Ça')).toBe('elise ca');
    expect(queryWords('  Élise   élise RENÉ ')).toEqual(['elise', 'rene']);
  });
});

describe('parseQuery', () => {
  it('reads fields, flags and has:attachment out of the query, and keeps the rest for the server as typed', () => {
    expect(parseQuery('From:Élise is:unread has:attachment café')).toEqual({
      words: ['cafe'],
      fields: [{ field: 'from', value: 'elise' }],
      seen: false,
      attachments: true,
      server: 'From:Élise is:unread café',
    });
  });

  it('asks the store for every word and field value', () => {
    expect(storeQuery(parseQuery('from:elise invoice is:starred'))).toEqual({
      terms: ['invoice', 'elise'],
      fields: true,
      seen: undefined,
      flagged: true,
      attachments: false,
    });
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

  it('keeps a value to its own field, and looks for to: in Cc as well', () => {
    const invoice = item(1, 100, { subject: 'Invoice for March', from: [{ name: 'Élise Martin', email: 'elise@shop.example' }] });
    const lunch = item(2, 200, { subject: 'Lunch', to: [{ email: 'team@example.com' }], cc: [{ email: 'boss@example.com' }] });
    const uids = (text: string) => rankResults([invoice, lunch], parseQuery(text)).map((m) => m.uid);
    expect(uids('subject:invoice')).toEqual([1]);
    expect(uids('from:elise')).toEqual([1]);
    expect(uids('from:team')).toEqual([]);
    expect(uids('to:boss')).toEqual([2]);
    expect(uids('cc:team')).toEqual([]);
  });
});
