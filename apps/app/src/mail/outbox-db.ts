import type { Draft, OutgoingAttachment } from '@/core';

import { database, nowSeconds, transaction } from './database';

export type QueuedMessage = { id: number; account: string; queuedAt: number; error: string | null; draft: Omit<Draft, 'attachments'> };

export async function enqueueMessage(account: string, { attachments, ...draft }: Draft, error: string | null = null) {
  let id = 0;
  await transaction(async (db) => {
    const { lastInsertRowId } = await db.runAsync(
      'INSERT INTO outbox (account, queued_at, draft, error) VALUES (?, ?, ?, ?)',
      account,
      nowSeconds(),
      JSON.stringify(draft),
      error,
    );
    id = lastInsertRowId;
    for (const [position, { filename, mimeType, data }] of attachments.entries()) {
      await db.runAsync(
        'INSERT INTO outbox_attachments (outbox, position, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)',
        lastInsertRowId,
        position,
        filename,
        mimeType,
        new Uint8Array(data),
      );
    }
  });
  return id;
}

type QueuedRow = { id: number; account: string; queued_at: number; draft: string; error: string | null };

const queuedMessage = (row: QueuedRow): QueuedMessage => ({
  id: row.id,
  account: row.account,
  queuedAt: row.queued_at,
  error: row.error,
  draft: JSON.parse(row.draft) as QueuedMessage['draft'],
});

export async function getQueuedMessages() {
  const db = await database();
  const rows = await db.getAllAsync<QueuedRow>('SELECT id, account, queued_at, draft, error FROM outbox ORDER BY id');
  return rows.map(queuedMessage);
}

export async function getQueuedMessage(id: number) {
  const db = await database();
  const row = await db.getFirstAsync<QueuedRow>('SELECT id, account, queued_at, draft, error FROM outbox WHERE id = ?', id);
  return row && queuedMessage(row);
}

export async function getQueuedAttachments(id: number): Promise<OutgoingAttachment[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ filename: string; mime_type: string; data: Uint8Array }>(
    'SELECT filename, mime_type, data FROM outbox_attachments WHERE outbox = ? ORDER BY position',
    id,
  );
  return rows.map((row) => ({ filename: row.filename, mimeType: row.mime_type, data: Uint8Array.from(row.data).buffer }));
}

export async function removeQueuedMessage(id: number) {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM outbox WHERE id = ?', id);
  });
}

// Queued like every write: run beside another transaction it would be undone with it, and the mark that keeps
// a message from being sent twice must not be.
export async function setQueuedError(id: number, error: string | null) {
  await transaction(async (db) => {
    await db.runAsync('UPDATE outbox SET error = ? WHERE id = ?', error, id);
  });
}

export type DraftAttachment = { key: string; filename: string; mimeType: string; size: number; data?: ArrayBuffer };

export async function setDraftAttachments(slot: string, attachments: DraftAttachment[]) {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM draft_attachments WHERE slot = ?', slot);
    for (const [position, { key, filename, mimeType, size, data }] of attachments.entries()) {
      await db.runAsync(
        'INSERT INTO draft_attachments (slot, position, key, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
        slot,
        position,
        key,
        filename,
        mimeType,
        size,
        data ? new Uint8Array(data) : null,
      );
    }
  });
}

type DraftAttachmentRow = { key: string; filename: string; mime_type: string; size: number; data: Uint8Array | null };

export async function getDraftAttachments(slot: string): Promise<DraftAttachment[]> {
  const db = await database();
  const rows = await db.getAllAsync<DraftAttachmentRow>(
    'SELECT key, filename, mime_type, size, data FROM draft_attachments WHERE slot = ? ORDER BY position',
    slot,
  );
  return rows.map((row) => ({
    key: row.key,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    data: row.data ? Uint8Array.from(row.data).buffer : undefined,
  }));
}

// Every account with queued mail, for finding what a removed account left behind.
export async function queuedAccounts() {
  const db = await database();
  const rows = await db.getAllAsync<{ account: string }>('SELECT DISTINCT account FROM outbox');
  return rows.map((row) => row.account);
}

export async function deleteQueuedMessages(account: string) {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM outbox WHERE account = ?', account);
  });
}
