import type { MessageSummary } from '@/core';
import { applySync, deleteAccountData, getSeenAddresses } from '@/mail/db';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const message = (uid: number, date: number, extra: Partial<MessageSummary>): MessageSummary => ({
  uid,
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
  subject: `Message ${uid}`,
  from: [],
  to: [],
  cc: [],
  replyTo: [],
  deliveredTo: [],
  date,
  references: [],
  preview: '',
  hasAttachments: false,
  size: 10,
  ...extra,
});

const state = { uidValidity: 1, uidNext: 10, highestModseq: 5n };
const sync = (account: string, changed: MessageSummary[]) =>
  applySync({ account, mailbox: 'INBOX' }, { state, reset: false, changed, vanished: [], truncated: false });

describe('seen addresses', () => {
  beforeEach(async () => {
    await deleteAccountData('a');
    await deleteAccountData('b');
  });

  it('collects everyone named in the headers, newest first', async () => {
    await sync('a', [
      message(1, 100, { from: [{ name: 'Bob', email: 'bob@example.org' }] }),
      message(2, 200, { to: [{ email: 'alice@example.org' }] }),
      message(3, 300, { from: [{ email: 'carol@example.org' }] }),
      message(4, 400, { cc: [{ name: 'Dan', email: 'dan@example.org' }] }),
    ]);
    expect((await getSeenAddresses()).map((a) => a.email)).toEqual([
      'dan@example.org',
      'carol@example.org',
      'alice@example.org',
      'bob@example.org',
    ]);
  });

  it('lists an address once under its newest name, whatever the case', async () => {
    await sync('a', [
      message(1, 100, { from: [{ name: 'Robert', email: 'Bob@Example.org' }] }),
      message(2, 300, { from: [{ name: 'Bob', email: 'bob@example.org' }] }),
      message(3, 200, { from: [{ name: 'Bobby', email: 'bob@example.org' }] }),
    ]);
    expect(await getSeenAddresses()).toEqual([{ name: 'Bob', email: 'bob@example.org' }]);
  });

  it('keeps a name it has when a later message carries none', async () => {
    await sync('a', [message(1, 100, { from: [{ name: 'Bob', email: 'bob@example.org' }] })]);
    await sync('a', [message(2, 200, { from: [{ email: 'bob@example.org' }] })]);
    expect(await getSeenAddresses()).toEqual([{ name: 'Bob', email: 'bob@example.org' }]);
  });

  it('forgets the addresses of a removed account only', async () => {
    await sync('a', [message(1, 100, { from: [{ email: 'a@example.org' }] })]);
    await sync('b', [message(1, 100, { from: [{ email: 'b@example.org' }] })]);
    await deleteAccountData('a');
    expect((await getSeenAddresses()).map((a) => a.email)).toEqual(['b@example.org']);
  });
});
