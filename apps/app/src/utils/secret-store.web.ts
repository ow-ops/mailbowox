import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { get, update } from 'idb-keyval';

// Secrets sit in localStorage, encrypted with a non-extractable AES-GCM key kept in IndexedDB. A copy of
// localStorage alone (disk image, backup) or another origin can't read them. Script running in this page
// can still ask the key to decrypt, and so can someone holding the whole browser profile.
const WRAPPING_KEY = 'secret-store.key';
const PREFIX = 'enc1:';
const IV_BYTES = 12;

const encoder = new TextEncoder();

async function createKey() {
  const saved = await get<CryptoKey>(WRAPPING_KEY);
  if (saved) return saved;
  const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // Another tab may have stored a key while this one was generating; the first one stored wins.
  await update<CryptoKey>(WRAPPING_KEY, (existing) => existing ?? fresh);
  return (await get<CryptoKey>(WRAPPING_KEY))!;
}

let wrappingKey: Promise<CryptoKey> | null = null;
const loadKey = () => (wrappingKey ??= createKey());

export async function setSecret(key: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // The name is authenticated so one entry's ciphertext can't be moved to another.
  const params = { name: 'AES-GCM', iv, additionalData: encoder.encode(key) };
  const sealed = new Uint8Array(await crypto.subtle.encrypt(params, await loadKey(), encoder.encode(value)));
  localStorage.setItem(key, PREFIX + bytesToHex(iv) + bytesToHex(sealed));
}

export async function getSecret(key: string) {
  const stored = localStorage.getItem(key);
  if (stored === null) return null;
  try {
    const bytes = hexToBytes(stored.slice(PREFIX.length));
    const params = { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: encoder.encode(key) };
    return new TextDecoder().decode(await crypto.subtle.decrypt(params, await loadKey(), bytes.slice(IV_BYTES)));
  } catch {
    // The wrapping key is gone (site data cleared in part), so the secret can't be recovered.
    return null;
  }
}

export const deleteSecret = async (key: string) => localStorage.removeItem(key);
