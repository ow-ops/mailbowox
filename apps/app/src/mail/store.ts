import { defaultDatabaseDirectory } from 'expo-sqlite';

import { core, type MailStore } from '@/core';

import { moveLegacyData } from './legacy';

async function open() {
  const store = await core.openStore(`${defaultDatabaseDirectory}/store.sqlite3`);
  await moveLegacyData(store);
  return store;
}

let opened: Promise<MailStore> | undefined;

// A failed open is not kept, so the next call tries again instead of failing until the app restarts.
export const mailStore = () =>
  (opened ??= open().catch((error: unknown) => {
    opened = undefined;
    throw error;
  }));
