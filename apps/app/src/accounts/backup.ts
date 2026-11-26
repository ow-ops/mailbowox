import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getRandomBytes } from 'expo-crypto';
import * as v from 'valibot';

import type { SyncedAccount } from '@/accounts/store';
import { t } from '@/i18n';
import { backupKey, open, seal } from '@/vault/crypto';
import { accountSchema } from '@/vault/document';

const SALT_BYTES = 16;

const fileSchema = v.object({ mailbowox: v.literal('backup'), salt: v.string(), data: v.string() });
const contentSchema = v.object({ accounts: v.array(accountSchema) });

function parse<S extends v.GenericSchema>(schema: S, text: string): v.InferOutput<S> | null {
  try {
    const result = v.safeParse(schema, JSON.parse(text));
    return result.success ? result.output : null;
  } catch {
    return null;
  }
}

export async function sealBackup(accounts: SyncedAccount[], password: string) {
  const salt = getRandomBytes(SALT_BYTES);
  const data = seal(await backupKey(password, salt), utf8ToBytes(JSON.stringify({ accounts })));
  return JSON.stringify({ mailbowox: 'backup', salt: bytesToHex(salt), data: bytesToHex(data) });
}

export async function openBackup(text: string, password: string): Promise<SyncedAccount[]> {
  const file = parse(fileSchema, text);
  if (!file) throw new Error(t('settings.devices.backup.errors.notBackup'));
  let plaintext: Uint8Array;
  try {
    plaintext = open(await backupKey(password, hexToBytes(file.salt)), hexToBytes(file.data));
  } catch {
    throw new Error(t('settings.devices.backup.errors.password'));
  }
  const content = parse(contentSchema, new TextDecoder().decode(plaintext));
  if (!content) throw new Error(t('settings.devices.backup.errors.notBackup'));
  return content.accounts;
}
