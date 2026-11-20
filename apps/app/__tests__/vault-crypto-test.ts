import { bytesToHex } from '@noble/hashes/utils.js';

import {
  createKeyPair,
  createOffer,
  createVaultKey,
  decodeOffer,
  encodeOffer,
  joinerSession,
  linkIds,
  offererSession,
  open,
  passphraseLocation,
  seal,
  vaultLocation,
} from '@/vault/crypto';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
}));

const text = (s: string) => new TextEncoder().encode(s);

describe('vault keys', () => {
  it('derives a separate id, auth secret and encryption key', () => {
    const { id, auth, enc } = vaultLocation(createVaultKey());
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(auth).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([id, auth, bytesToHex(enc)]).size).toBe(3);
  });

  it('derives the same location from the same key and another from another key', () => {
    const key = createVaultKey();
    expect(vaultLocation(key)).toEqual(vaultLocation(Uint8Array.from(key)));
    expect(vaultLocation(createVaultKey()).id).not.toBe(vaultLocation(key).id);
  });
});

describe('seal and open', () => {
  const { enc } = vaultLocation(createVaultKey());

  it('round-trips', () => {
    expect(open(enc, seal(enc, text('accounts')))).toEqual(text('accounts'));
  });

  it('uses a fresh nonce every time', () => {
    expect(seal(enc, text('a'))).not.toEqual(seal(enc, text('a')));
  });

  it('rejects another key', () => {
    const other = vaultLocation(createVaultKey()).enc;
    expect(() => open(other, seal(enc, text('accounts')))).toThrow();
  });

  it('rejects a tampered ciphertext, nonce or format byte', () => {
    const blob = seal(enc, text('accounts'));
    for (const index of [0, 5, blob.length - 1]) {
      const tampered = Uint8Array.from(blob);
      tampered[index] ^= 1;
      expect(() => open(enc, tampered)).toThrow();
    }
  });
});

describe('passphrase', () => {
  it('unwraps the vault key with the same passphrase and email only', async () => {
    const vaultKey = createVaultKey();
    const slot = await passphraseLocation('correct horse battery', 'Alice@Example.com ');
    const wrapped = seal(slot.enc, vaultKey);

    const again = await passphraseLocation('correct horse battery', 'alice@example.com');
    expect(again.id).toBe(slot.id);
    expect(open(again.enc, wrapped)).toEqual(vaultKey);

    const wrong = await passphraseLocation('correct horse batterz', 'alice@example.com');
    expect(wrong.id).not.toBe(slot.id);
    expect(() => open(wrong.enc, wrapped)).toThrow();

    const otherUser = await passphraseLocation('correct horse battery', 'bob@example.com');
    expect(otherUser.id).not.toBe(slot.id);
  }, 60_000);
});

describe('device linking', () => {
  it('agrees on a key and code on both sides', () => {
    const offerKeys = createKeyPair();
    const offer = decodeOffer(encodeOffer(createOffer('https://gw.example', offerKeys)))!;
    const joinerKeys = createKeyPair();
    const joiner = joinerSession(offer, joinerKeys);
    const offerer = offererSession(offer, offerKeys, joinerKeys.publicKey);
    expect(offerer).toEqual(joiner);
    expect(joiner.code).toMatch(/^\d{6}$/);

    const vaultKey = createVaultKey();
    expect(open(joiner.key, seal(offerer.key, vaultKey))).toEqual(vaultKey);
  });

  it('shows a different code when someone else answers the offer', () => {
    const offerKeys = createKeyPair();
    const offer = createOffer('https://gw.example', offerKeys);
    const joiner = joinerSession(offer, createKeyPair());
    const intruder = offererSession(offer, offerKeys, createKeyPair().publicKey);
    expect(intruder.code).not.toBe(joiner.code);
    expect(intruder.key).not.toEqual(joiner.key);
  });

  it('keeps the two rendezvous ids apart', () => {
    const { joiner, vaultKey } = linkIds(createOffer('https://gw.example', createKeyPair()));
    expect(joiner).toMatch(/^[0-9a-f]{64}$/);
    expect(vaultKey).not.toBe(joiner);
  });

  it('ignores QR codes that are not offers', () => {
    expect(decodeOffer('https://example.com')).toBeNull();
    expect(decodeOffer('{"mailbowox":"link","gateway":"x","key":"00","secret":"00"}')).toBeNull();
  });
});
