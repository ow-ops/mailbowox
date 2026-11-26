import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getRandomBytes } from 'expo-crypto';

const FORMAT = 1;
const NONCE_BYTES = 24;

// OWASP's argon2id baseline (19 MiB, 2 passes): pure JS on a phone already takes a few seconds.
const ARGON = { t: 2, m: 19 * 1024, p: 1, dkLen: 32, asyncTick: 50 };

export type KeyPair = ReturnType<typeof x25519.keygen>;

// Where a key lives on the gateway (id), the bearer secret that guards it (auth) and the key that seals it (enc).
export type Location = { id: string; auth: string; enc: Uint8Array };

const derive = (key: Uint8Array, info: string, salt?: Uint8Array, length = 32) =>
  hkdf(sha256, key, salt, utf8ToBytes(info), length);

const locate = (key: Uint8Array, name: string): Location => ({
  id: bytesToHex(derive(key, `mailbowox ${name} id`)),
  auth: bytesToHex(derive(key, `mailbowox ${name} auth`)),
  enc: derive(key, `mailbowox ${name} enc`),
});

export const createVaultKey = () => getRandomBytes(32);

export const vaultLocation = (key: Uint8Array) => locate(key, 'vault');

// The passphrase cannot find the vault by itself, so it unlocks a slot that holds the wrapped vault key.
// The email salts it, so two people with the same passphrase never share a slot.
export async function passphraseLocation(passphrase: string, email: string) {
  const salt = sha256(utf8ToBytes(`mailbowox passphrase ${email.trim().toLowerCase()}`));
  return locate(await argon2idAsync(passphrase.normalize('NFC'), salt, ARGON), 'passphrase');
}

export const backupKey = (password: string, salt: Uint8Array) =>
  argon2idAsync(password.normalize('NFC'), salt, ARGON);

export function seal(key: Uint8Array, plaintext: Uint8Array) {
  const header = Uint8Array.of(FORMAT);
  const nonce = getRandomBytes(NONCE_BYTES);
  return concatBytes(header, nonce, xchacha20poly1305(key, nonce, header).encrypt(plaintext));
}

// Throws on a wrong key, a tampered blob or a format this build does not know.
export function open(key: Uint8Array, blob: Uint8Array) {
  if (blob[0] !== FORMAT) throw new Error(`Unknown vault format ${blob[0]}`);
  const nonce = blob.subarray(1, 1 + NONCE_BYTES);
  return xchacha20poly1305(key, nonce, blob.subarray(0, 1)).decrypt(blob.subarray(1 + NONCE_BYTES));
}

export type LinkOffer = { gateway: string; publicKey: Uint8Array; secret: Uint8Array };

export const createKeyPair = (): KeyPair => x25519.keygen(getRandomBytes(32));

export const createOffer = (gateway: string, keys: KeyPair): LinkOffer => ({
  gateway,
  publicKey: keys.publicKey,
  secret: getRandomBytes(16),
});

export const encodeOffer = (offer: LinkOffer) =>
  JSON.stringify({ mailbowox: 'link', gateway: offer.gateway, key: bytesToHex(offer.publicKey), secret: bytesToHex(offer.secret) });

// Null for any QR code that is not a link offer.
export function decodeOffer(data: string): LinkOffer | null {
  try {
    const { mailbowox, gateway, key, secret } = JSON.parse(data);
    if (mailbowox !== 'link' || typeof gateway !== 'string') return null;
    const offer = { gateway, publicKey: hexToBytes(key), secret: hexToBytes(secret) };
    return offer.publicKey.length === 32 && offer.secret.length === 16 ? offer : null;
  } catch {
    return null;
  }
}

// The gateway only ever sees these ids. The secret behind them stays in the QR code.
export const linkIds = (offer: LinkOffer) => ({
  joiner: bytesToHex(derive(offer.secret, 'mailbowox link joiner')),
  vaultKey: bytesToHex(derive(offer.secret, 'mailbowox link vault key')),
});

export type LinkSession = { key: Uint8Array; code: string };

function session(shared: Uint8Array, offer: LinkOffer, joinerKey: Uint8Array): LinkSession {
  const transcript = concatBytes(offer.publicKey, joinerKey);
  const key = hkdf(sha256, shared, offer.secret, concatBytes(utf8ToBytes('mailbowox link key'), transcript), 32);
  const digits = hkdf(sha256, shared, offer.secret, concatBytes(utf8ToBytes('mailbowox link code'), transcript), 4);
  const number = new DataView(digits.buffer, digits.byteOffset, 4).getUint32(0) % 1_000_000;
  return { key, code: String(number).padStart(6, '0') };
}

export const offererSession = (offer: LinkOffer, keys: KeyPair, joinerKey: Uint8Array) =>
  session(x25519.getSharedSecret(keys.secretKey, joinerKey), offer, joinerKey);

export const joinerSession = (offer: LinkOffer, keys: KeyPair) =>
  session(x25519.getSharedSecret(keys.secretKey, offer.publicKey), offer, keys.publicKey);
