import type { MailStore } from '@/core';
import { database } from '@/mail/database';
import { moveLegacyOutbox } from '@/mail/legacy-outbox';

import { store } from '../jest/mail-store';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));
jest.mock('@/utils/kv', () => {
  const items = new Map<string, string>();
  return { readItem: (key: string) => items.get(key) ?? null, writeItem: (key: string, value: string) => items.set(key, value) };
});

const draft = { from: { email: 'me@example.com' }, to: [{ email: 'you@example.com' }], cc: [], bcc: [], subject: 'Queued', text: 'hi', references: [] };

describe('moveLegacyOutbox', () => {
  it('queues what mail.db held in the store once, and leaves mail.db empty', async () => {
    const db = await database();
    const { lastInsertRowId } = await db.runAsync(
      'INSERT INTO outbox (account, queued_at, draft, error) VALUES (?, ?, ?, ?)',
      'a',
      1,
      JSON.stringify(draft),
      'unconfirmed',
    );
    await db.runAsync(
      'INSERT INTO outbox_attachments (outbox, position, filename, mime_type, data) VALUES (?, 0, ?, ?, ?)',
      lastInsertRowId,
      'a.txt',
      'text/plain',
      new Uint8Array([1, 2]),
    );
    await db.runAsync(
      "INSERT INTO draft_attachments (slot, position, key, filename, mime_type, size, data) VALUES ('new/', 0, 'k', 'b.pdf', 'application/pdf', 3, NULL)",
    );

    await moveLegacyOutbox(store as unknown as MailStore);
    await moveLegacyOutbox(store as unknown as MailStore);

    const queued = await store.queuedMessages();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ account: 'a', error: 'unconfirmed', draft: { subject: 'Queued' } });
    const [attachment] = await store.queuedAttachments(queued[0].id);
    expect([attachment.filename, [...new Uint8Array(attachment.data)]]).toEqual(['a.txt', [1, 2]]);
    expect(await store.draftAttachments('new/')).toEqual([
      { key: 'k', filename: 'b.pdf', mimeType: 'application/pdf', size: 3, data: undefined },
    ]);
    expect(await db.getAllAsync('SELECT id FROM outbox')).toEqual([]);
    expect(await db.getAllAsync('SELECT slot FROM draft_attachments')).toEqual([]);
  });
});
