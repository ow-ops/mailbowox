import * as SQLite from 'expo-sqlite';

import { t } from '@/i18n';
import { invoke } from '@/utils/desktop';

import BackupExclusion from '../../modules/backup-exclusion';
import { desktopDatabase } from './desktop';

// What the app asks of a database, so that the desktop shell's can stand in for expo-sqlite's.
export type Database = Pick<
  SQLite.SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'withTransactionAsync'
>;

// Migration n takes the database from user_version n to n + 1, so a database is current once its user_version
// equals the number of migrations. Never edit a migration that has shipped: append a new one.
export async function migrate(db: Database, name: string, migrations: string[]) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > migrations.length) throw new Error(t('common.databaseTooNew', { name }));
  for (let version = current; version < migrations.length; version++) {
    // Nothing else holds the connection yet, so the plain transaction is enough; the exclusive one is
    // unavailable on web.
    await db.withTransactionAsync(() => db.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`));
  }
}

// On web, expo-sqlite's worker reads each new connection handle from one scratch slot shared by every open, so
// overlapping opens can all come back with the last handle and run on the same file. One open at a time avoids it.
let opening: Promise<unknown> = Promise.resolve();

function openOneAtATime(name: string) {
  const open = opening.then(() => SQLite.openDatabaseAsync(name));
  opening = open.catch(() => {});
  return open;
}

export async function openDatabase(name: string, migrations: string[]) {
  const db: Database = invoke ? desktopDatabase(invoke, name) : await openOneAtATime(name);
  // Foreign keys are off by default, and the setting belongs to the connection.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db, name, migrations);
  // Every database here copies what the servers hold, so none of it goes into iCloud or computer backups.
  // The mark is set again on each open, as SQLite recreates its journal files.
  BackupExclusion?.exclude(SQLite.defaultDatabaseDirectory);
  return db;
}

export function lazyDatabase(name: string, migrations: string[]) {
  let opened: Promise<Database> | undefined;
  // A failed open is not kept, so the next call tries again instead of failing until the app restarts.
  return () =>
    (opened ??= openDatabase(name, migrations).catch((error: unknown) => {
      opened = undefined;
      throw error;
    }));
}
