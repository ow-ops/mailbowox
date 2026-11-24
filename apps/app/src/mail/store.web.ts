import { sqlChannel } from '@mailbowox/core-native/src/sql.web';

import { core, type MailStore } from '@/core';

import { moveLegacyData } from './legacy';
import { invoke } from '@/utils/desktop';

const DATABASE = 'store.sqlite3';

// The desktop shell keeps the file itself; a browser keeps it in OPFS, through the worker.
async function run(request: ArrayBuffer): Promise<ArrayBuffer> {
  if (invoke) return invoke<ArrayBuffer>('db_batch', new Uint8Array(request));
  const reply = await sqlChannel().run(new Uint8Array(request));
  return reply.buffer.slice(reply.byteOffset, reply.byteOffset + reply.byteLength) as ArrayBuffer;
}

async function open() {
  const store = await core.openStoreWith(run, DATABASE);
  await moveLegacyData(store);
  return store;
}

let opened: Promise<MailStore> | undefined;

export const mailStore = () =>
  (opened ??= open().catch((error: unknown) => {
    opened = undefined;
    throw error;
  }));
