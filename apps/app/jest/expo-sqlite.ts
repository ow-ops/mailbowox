// expo-sqlite is native; tests run the same queries on Node's built-in SQLite.
type Statement = { run(...p: never[]): unknown; all(...p: never[]): unknown[]; get(...p: never[]): unknown };
type Database = { exec(sql: string): void; prepare(sql: string): Statement };

const { DatabaseSync } = jest.requireActual('node:sqlite') as { DatabaseSync: new (path: string) => Database };
const args = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];

const adapt = (db: Database) => ({
  execAsync: async (sql: string) => db.exec(sql),
  runAsync: async (sql: string, ...params: unknown[]) => {
    const { changes, lastInsertRowid } = db.prepare(sql).run(...args(params)) as { changes: number; lastInsertRowid: number };
    return { changes, lastInsertRowId: lastInsertRowid };
  },
  getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...args(params)),
  getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...args(params)) ?? null,
  withTransactionAsync: async (task: () => Promise<void>) => {
    db.exec('BEGIN');
    try {
      await task();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
});

export const openDatabaseAsync = async () => adapt(new DatabaseSync(':memory:'));

// Every database here is in memory and gone with its connection.
export async function deleteDatabaseAsync(_name: string) {}
