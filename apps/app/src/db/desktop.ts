import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import type { Database } from './migrate';

type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;
type Outcome = { rows: Record<string, unknown>[]; changes: number; lastInsertRowId: number };

const args = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);

// JSON has no bytes, so a blob crosses to the shell and back as { hex }.
const toShell = (value: unknown) => (value instanceof Uint8Array ? { hex: bytesToHex(value) } : value);
const fromShell = (value: unknown) =>
  typeof value === 'object' && value !== null && 'hex' in value ? hexToBytes(value.hex as string) : value;

// expo-sqlite's web build needs SharedArrayBuffer, which the shell's webview does not have.
export function desktopDatabase(invoke: Invoke, name: string) {
  const exec = (sql: string) => invoke<void>('db_exec', { name, sql });
  const query = async (sql: string, params: unknown[]) => {
    const outcome = await invoke<Outcome>('db_query', { name, sql, params: args(params).map(toShell) });
    const rows = outcome.rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, fromShell(value)])));
    return { ...outcome, rows };
  };
  return {
    execAsync: exec,
    runAsync: async (sql: string, ...params: unknown[]) => {
      const { changes, lastInsertRowId } = await query(sql, params);
      return { changes, lastInsertRowId };
    },
    getAllAsync: async (sql: string, ...params: unknown[]) => (await query(sql, params)).rows,
    getFirstAsync: async (sql: string, ...params: unknown[]) => (await query(sql, params)).rows[0] ?? null,
    withTransactionAsync: async (task: () => Promise<void>) => {
      await exec('BEGIN');
      try {
        await task();
        await exec('COMMIT');
      } catch (error) {
        await exec('ROLLBACK');
        throw error;
      }
    },
  } as Database;
}
