import { defaultDatabaseDirectory } from 'expo-sqlite';

import { core, type MailStore } from '@/core';

import BackupExclusion from '../../modules/backup-exclusion';
import { removeLegacyData } from './legacy';

async function open() {
  const store = await core.openStore(`${defaultDatabaseDirectory}/store.sqlite3`);
  // The store copies what the servers hold, so none of it goes into iCloud or computer backups. The mark is set
  // again on each open, as SQLite recreates its journal files.
  BackupExclusion?.exclude(defaultDatabaseDirectory);
  await removeLegacyData();
  return store;
}

let opened: Promise<MailStore> | undefined;

// A failed open is not kept, so the next call tries again instead of failing until the app restarts.
export const mailStore = () =>
  (opened ??= open().catch((error: unknown) => {
    opened = undefined;
    throw error;
  }));
