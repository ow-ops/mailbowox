import type { MessageSummary } from '@/core';
import { getBody, putMessages, saveBody } from '@/mail/db';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const summary = (uid: number, flagged = false): MessageSummary => ({
  uid,
  flags: { seen: true, flagged, answered: false, draft: false, deleted: false },
  subject: `Message ${uid}`,
  from: [{ email: 'sender@example.com' }],
  to: [],
  cc: [],
  replyTo: [],
  deliveredTo: [],
  date: uid,
  references: [],
  preview: '',
  hasAttachments: false,
  size: 10,
});

const ref = (uid: number) => ({ account: 'a', mailbox: 'INBOX', uidValidity: 1, uid });
const big = (uid: number) => ({
  uid,
  text: 'x'.repeat(20 * 1024 * 1024),
  hasRemoteContent: false,
  blockedRemote: 0,
  listUnsubscribe: [], listUnsubscribeOneClick: false,
  attachments: [],
});

const cached = async (uids: number[]) =>
  (await Promise.all(uids.map(async (uid) => ((await getBody(ref(uid), false)) ? uid : null)))).filter((uid) => uid);

describe('body cache', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  const at = (seconds: number) => jest.setSystemTime(seconds * 1000);

  it('evicts the least recently opened bodies once the cache is over its size', async () => {
    await putMessages([1, 2, 3].map((uid) => ({ ...ref(uid), summary: summary(uid) })));
    at(1000);
    await saveBody(ref(1), big(1), false);
    at(2000);
    await saveBody(ref(2), big(2), false);
    at(3000);
    await getBody(ref(1), false);
    at(4000);
    await saveBody(ref(3), big(3), false);

    expect(await cached([1, 2, 3])).toEqual([1, 3]);
  });

  it('keeps the bodies of flagged messages however old they are', async () => {
    await putMessages([11, 12, 13, 14].map((uid) => ({ ...ref(uid), summary: summary(uid, uid === 11) })));
    at(5000);
    await saveBody(ref(11), big(11), false);
    at(6000);
    await saveBody(ref(12), big(12), false);
    at(7000);
    await saveBody(ref(13), big(13), false);
    at(8000);
    await saveBody(ref(14), big(14), false);

    expect(await cached([11, 12, 13, 14])).toEqual([11, 13, 14]);
  });

  it('keeps the latest body even when it alone is over the cache size', async () => {
    await putMessages([{ ...ref(21), summary: summary(21) }]);
    at(9000);
    await saveBody(ref(21), { ...big(21), text: 'x'.repeat(60 * 1024 * 1024) }, false);

    expect(await cached([21])).toEqual([21]);
  });

  it('measures a body by its UTF-8 bytes', async () => {
    await putMessages([31, 32].map((uid) => ({ ...ref(uid), summary: summary(uid) })));
    at(10_000);
    await saveBody(ref(31), { ...big(31), text: 'é'.repeat(15 * 1024 * 1024) }, false);
    at(11_000);
    await saveBody(ref(32), big(32), false);

    expect(await cached([31, 32])).toEqual([32]);
  });
});
