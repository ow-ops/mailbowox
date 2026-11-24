import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8, concatBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as v from 'valibot';

import type { PushKeys } from './keys';

// RFC 8291 decryption, as targets/push/WebPush.swift does on iOS. The gateway encrypts in
// crates/gateway/src/push/preview.rs.

const fromBase64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function decrypt(sealed: string, keys: PushKeys): string {
  const body = fromBase64url(sealed);
  const idLength = body[20];
  if (idLength !== 65 || body.length < 21 + idLength + 17) throw new Error('malformed push preview');
  const salt = body.subarray(0, 16);
  const serverKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);

  const publicKey = fromBase64url(keys.publicKey);
  const ecdh = p256.getSharedSecret(fromBase64url(keys.privateKey), serverKey).subarray(1);
  const ikm = hkdf(sha256, ecdh, fromBase64url(keys.auth), concatBytes(utf8ToBytes('WebPush: info\0'), publicKey, serverKey), 32);
  const cek = hkdf(sha256, ikm, salt, utf8ToBytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sha256, ikm, salt, utf8ToBytes('Content-Encoding: nonce\0'), 12);
  const padded = gcm(cek, nonce).decrypt(ciphertext);

  // A single record: the plaintext ends with the 0x02 delimiter and optional zero padding.
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  if (padded[end - 1] !== 2) throw new Error('push preview is not a final record');
  return bytesToUtf8(padded.subarray(0, end - 1));
}

const preview = v.object({ title: v.string(), subtitle: v.string(), body: v.string() });

export type Preview = v.InferOutput<typeof preview>;

/** `null` for anything that does not open, so the caller shows its plain notification. */
export function openPreview(sealed: unknown, keys: PushKeys): Preview | null {
  if (typeof sealed !== 'string') return null;
  try {
    const result = v.safeParse(preview, JSON.parse(decrypt(sealed, keys)));
    return result.success ? result.output : null;
  } catch {
    return null;
  }
}
