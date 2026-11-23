import { p256 } from '@noble/curves/nist.js';

import { createPushKeys } from '@/push/keys';

const fromBase64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

jest.mock('@/push/config', () => ({ PUSH_KEYCHAIN_SERVICE: 'mailbowox.push', PUSH_KEYS_KEY: 'push-keys' }));

describe('push keys', () => {
  it('pairs an uncompressed P-256 public key with its private key, all base64url', () => {
    let seed = 1;
    const keys = createPushKeys((length) => Uint8Array.from({ length }, () => seed++));

    for (const value of Object.values(keys)) expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    const publicKey = fromBase64url(keys.publicKey);
    expect(publicKey).toHaveLength(65);
    expect(publicKey[0]).toBe(4);
    expect(p256.getPublicKey(fromBase64url(keys.privateKey), false)).toEqual(publicKey);
    expect(fromBase64url(keys.auth)).toHaveLength(16);
  });
});
