import type { Database } from './migrate';

// withTransactionAsync is not exclusive: overlapping calls share the connection's one transaction and the
// first COMMIT ends both. Writes queue so each transaction runs alone.
export function transactionQueue(database: () => Promise<Database>) {
  let writes: Promise<unknown> = Promise.resolve();
  return (task: (db: Database) => Promise<void>) => {
    const run = writes.then(async () => {
      const db = await database();
      await db.withTransactionAsync(() => task(db));
    });
    writes = run.catch(() => {});
    return run;
  };
}
