import * as SQLite from 'expo-sqlite';

import { MIGRATIONS as contacts } from '@/contacts/db';
import { migrate, openDatabase } from '@/db/migrate';
import i18n from '@/i18n';
import { MIGRATIONS as mail } from '@/mail/database';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const open = () => SQLite.openDatabaseAsync('test.db');
type Db = Awaited<ReturnType<typeof open>>;

const version = async (db: Db) => (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version;

const tables = async (db: Db) =>
  (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(
    (row) => row.name,
  );

// Every table and index with its SQL, so an upgrade that ends with a different column or index shows up.
const schema = async (db: Db) =>
  (
    await db.getAllAsync<{ type: string; name: string; sql: string | null }>(
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name",
    )
  ).map((row) => ({ ...row, sql: row.sql?.replace(/\s+/g, ' ').trim() ?? null }));

beforeAll(() => i18n.changeLanguage('en'));

describe.each([
  ['mail', mail],
  ['contacts', contacts],
])('%s migrations', (name, migrations) => {
  it('builds the current schema on an empty database', async () => {
    const db = await open();
    await migrate(db, name, migrations);
    expect(await version(db)).toBe(migrations.length);
  });

  it.each(migrations.map((_, i) => i))('upgrades a database left at version %i', async (from) => {
    const db = await open();
    await migrate(db, name, migrations.slice(0, from));
    await migrate(db, name, migrations);

    const fresh = await open();
    await migrate(fresh, name, migrations);
    expect(await version(db)).toBe(migrations.length);
    expect(await schema(db)).toEqual(await schema(fresh));
  });

  it('leaves a current database alone', async () => {
    const db = await open();
    await migrate(db, name, migrations);
    await db.execAsync("CREATE TABLE marker (id INTEGER); INSERT INTO marker VALUES (1);");
    await migrate(db, name, migrations);
    expect(await db.getAllAsync('SELECT id FROM marker')).toEqual([{ id: 1 }]);
  });

  it('refuses a database written by a newer app and changes nothing', async () => {
    const db = await open();
    await migrate(db, name, migrations);
    await db.execAsync(`PRAGMA user_version = ${migrations.length + 1}`);
    const before = await tables(db);

    await expect(migrate(db, name, migrations)).rejects.toThrow(`The ${name} database was written by a newer version`);
    expect(await version(db)).toBe(migrations.length + 1);
    expect(await tables(db)).toEqual(before);
  });
});

describe('a failing migration', () => {
  it('rolls back its changes and keeps the version', async () => {
    const db = await open();
    const migrations = ['CREATE TABLE a (id INTEGER);', 'CREATE TABLE b (id INTEGER); INSERT INTO missing VALUES (1);'];

    await expect(migrate(db, 'test', migrations)).rejects.toThrow();

    expect(await version(db)).toBe(1);
    expect(await tables(db)).toEqual(['a']);
  });
});

describe('mail outbox', () => {
  it('removes a queued message\'s attachments with it', async () => {
    const db = await open();
    await migrate(db, 'mail', mail);
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      INSERT INTO outbox (id, account, queued_at, draft) VALUES (1, 'a', 0, '{}');
      INSERT INTO outbox_attachments (outbox, position, filename, mime_type, data) VALUES (1, 0, 'a.txt', 'text/plain', x'00');
      DELETE FROM outbox;
    `);
    expect(await db.getAllAsync('SELECT filename FROM outbox_attachments')).toEqual([]);
  });
});

describe('mail indexes', () => {
  it('serves the unread count from the partial index', async () => {
    const db = await open();
    await migrate(db, 'mail', mail);
    const plan = await db.getAllAsync<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT mailbox, COUNT(*) FROM messages WHERE account = 'a' AND seen = 0 GROUP BY mailbox",
    );
    expect(plan.map((row) => row.detail).join('\n')).toContain('messages_unread');
  });
});

describe('opening databases', () => {
  it('starts an open only once the one before it has finished', async () => {
    const actual = SQLite.openDatabaseAsync;
    let pending = 0;
    let most = 0;
    jest.spyOn(SQLite, 'openDatabaseAsync').mockImplementation(async (...args) => {
      most = Math.max(most, ++pending);
      await new Promise((resolve) => setTimeout(resolve, 5));
      pending--;
      return actual(...args);
    });

    await Promise.all([
      openDatabase('mail.db', mail),
      openDatabase('contacts.db', contacts),
    ]);

    expect(most).toBe(1);
  });
});
