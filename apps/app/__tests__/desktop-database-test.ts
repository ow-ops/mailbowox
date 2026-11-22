import { desktopDatabase } from '@/db/desktop';

const invoke = jest.fn();
const db = desktopDatabase(invoke, 'mail.db');
const outcome = (rows: Record<string, unknown>[] = []) => ({ rows, changes: 1, lastInsertRowId: 7 });

describe('desktop database', () => {
  beforeEach(() => invoke.mockReset());

  it('sends a statement with its parameters, a blob as hex', async () => {
    invoke.mockResolvedValue(outcome());
    const result = await db.runAsync('INSERT INTO t VALUES (?, ?, ?)', 'a', null, new Uint8Array([0, 255]));

    expect(invoke).toHaveBeenCalledWith('db_query', {
      name: 'mail.db',
      sql: 'INSERT INTO t VALUES (?, ?, ?)',
      params: ['a', null, { hex: '00ff' }],
    });
    expect(result).toEqual({ changes: 1, lastInsertRowId: 7 });
  });

  it('takes the parameters as one list too', async () => {
    invoke.mockResolvedValue(outcome());
    await db.getAllAsync('SELECT * FROM t WHERE a = ? AND b = ?', ['a', 2]);

    expect(invoke.mock.calls[0][1].params).toEqual(['a', 2]);
  });

  it('returns rows with their blobs as bytes', async () => {
    invoke.mockResolvedValue(outcome([{ name: 'a', data: { hex: '00ff' }, error: null }]));

    expect(await db.getAllAsync('SELECT * FROM t')).toEqual([{ name: 'a', data: new Uint8Array([0, 255]), error: null }]);
  });

  it('returns the first row, or null when there is none', async () => {
    invoke.mockResolvedValueOnce(outcome([{ id: 1 }, { id: 2 }])).mockResolvedValueOnce(outcome());

    expect(await db.getFirstAsync('SELECT id FROM t')).toEqual({ id: 1 });
    expect(await db.getFirstAsync('SELECT id FROM t')).toBeNull();
  });

  it('commits a transaction that ran', async () => {
    invoke.mockResolvedValue(outcome());
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM t');
    });

    expect(invoke.mock.calls.map(([command, { sql }]) => [command, sql])).toEqual([
      ['db_exec', 'BEGIN'],
      ['db_query', 'DELETE FROM t'],
      ['db_exec', 'COMMIT'],
    ]);
  });

  it('rolls back a transaction that threw, and passes the error on', async () => {
    invoke.mockResolvedValue(outcome());
    const failed = db.withTransactionAsync(async () => {
      throw new Error('no');
    });

    await expect(failed).rejects.toThrow('no');
    expect(invoke.mock.calls.map(([, { sql }]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
