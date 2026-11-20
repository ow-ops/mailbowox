import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { deleteSecret, getSecret, setSecret } from '@/utils/secret-store';

const KEY = 'vault.key';

export async function loadVaultKey() {
  const saved = await getSecret(KEY);
  return saved ? hexToBytes(saved) : null;
}

export const saveVaultKey = (key: Uint8Array) => setSecret(KEY, bytesToHex(key));
export const deleteVaultKey = () => deleteSecret(KEY);
