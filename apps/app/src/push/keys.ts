import { p256 } from '@noble/curves/nist.js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { PUSH_KEYCHAIN_SERVICE, PUSH_KEYS_KEY } from './config';

// Read by the notification service extension while the phone is locked.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: PUSH_KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export type PushKeys = { privateKey: string; publicKey: string; auth: string };

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createPushKeys(randomBytes: (length: number) => Uint8Array): PushKeys {
  const { secretKey } = p256.keygen(randomBytes(48));
  return {
    privateKey: base64url(secretKey),
    publicKey: base64url(p256.getPublicKey(secretKey, false)),
    auth: base64url(randomBytes(16)),
  };
}

let creating: Promise<PushKeys> | null = null;

// Accounts registering at once must share one pair.
export function getOrCreatePushKeys(): Promise<PushKeys> {
  creating ??= loadOrCreate().finally(() => {
    creating = null;
  });
  return creating;
}

async function loadOrCreate() {
  const saved = await SecureStore.getItemAsync(PUSH_KEYS_KEY, OPTIONS);
  if (saved) return JSON.parse(saved) as PushKeys;
  const keys = createPushKeys(getRandomBytes);
  await SecureStore.setItemAsync(PUSH_KEYS_KEY, JSON.stringify(keys), OPTIONS);
  return keys;
}
