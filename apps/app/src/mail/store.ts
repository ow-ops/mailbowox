import { defaultDatabaseDirectory } from 'expo-sqlite';

import { core, type MailStore } from '@/core';

let opened: Promise<MailStore> | undefined;

// A failed open is not kept, so the next call tries again instead of failing until the app restarts.
export const mailStore = () =>
  (opened ??= core.openStore(`${defaultDatabaseDirectory}/store.sqlite3`).catch((error: unknown) => {
    opened = undefined;
    throw error;
  }));
