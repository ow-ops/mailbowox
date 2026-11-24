import { deleteDatabaseAsync } from 'expo-sqlite';

import type { Draft, DraftAttachment, MailStore } from '@/core';
import { invoke } from '@/utils/desktop';
import { readItem, writeItem } from '@/utils/kv';

import { database } from './database';

const MOVED = 'outbox.moved';

type QueuedRow = { id: number; account: string; draft: string; error: string | null };
type AttachmentRow = { filename: string; mime_type: string; data: Uint8Array };
type DraftRow = { slot: string; key: string; filename: string; mime_type: string; size: number; data: Uint8Array | null };

const buffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;

// The outbox and draft attachments were in mail.db until they moved to the core's store. Each message leaves
// mail.db as soon as the store has it, so a move cut short never queues one twice. Contacts sync again, so
// contacts.db only goes; the desktop shell keeps its file, which nothing reads.
export async function moveLegacyData(store: MailStore) {
  if (readItem(MOVED)) return;
  const db = await database();
  for (const row of await db.getAllAsync<QueuedRow>('SELECT id, account, draft, error FROM outbox ORDER BY id')) {
    const attachments = await db.getAllAsync<AttachmentRow>(
      'SELECT filename, mime_type, data FROM outbox_attachments WHERE outbox = ? ORDER BY position',
      row.id,
    );
    const draft: Draft = {
      ...(JSON.parse(row.draft) as Omit<Draft, 'attachments'>),
      attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mime_type, data: buffer(a.data) })),
    };
    await store.enqueue(row.account, draft, row.error);
    await db.runAsync('DELETE FROM outbox WHERE id = ?', row.id);
  }
  const slots = new Map<string, DraftAttachment[]>();
  for (const row of await db.getAllAsync<DraftRow>('SELECT * FROM draft_attachments ORDER BY slot, position')) {
    const list = slots.get(row.slot) ?? [];
    list.push({ key: row.key, filename: row.filename, mimeType: row.mime_type, size: row.size, data: row.data ? buffer(row.data) : undefined });
    slots.set(row.slot, list);
  }
  for (const [slot, list] of slots) await store.setDraftAttachments(slot, list);
  await db.runAsync('DELETE FROM draft_attachments');
  if (!invoke) await deleteDatabaseAsync('contacts.db').catch(() => {});
  writeItem(MOVED, '1');
}
