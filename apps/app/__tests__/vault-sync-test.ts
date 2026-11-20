import { hexToBytes } from '@noble/hashes/utils.js';

import { vaultLocation } from '@/vault/crypto';
import { deleteVault, syncVault, unlockWithPassphrase } from '@/vault/sync';

const mockItems = new Map<string, string>();
const mockSecrets = new Map<string, string>();
// The gateway: blobs by id, and the ids whose vault was deleted.
const mockBlobs = new Map<string, { data: Uint8Array; version: number }>();
const mockDeleted = new Set<string>();
const mockToasts: string[] = [];

jest.mock('@/utils/kv', () => ({
  readItem: (key: string) => mockItems.get(key) ?? null,
  writeItem: (key: string, value: string) => mockItems.set(key, value),
}));
jest.mock('@/utils/secret-store', () => ({
  getSecret: async (key: string) => mockSecrets.get(key) ?? null,
  setSecret: async (key: string, value: string) => mockSecrets.set(key, value),
  deleteSecret: async (key: string) => mockSecrets.delete(key),
}));
jest.mock('@/utils/toast', () => ({ showError: (title: string) => mockToasts.push(title) }));
jest.mock('@/utils/relay', () => ({ applyRelay: () => undefined }));
jest.mock('@/accounts/forget', () => ({ forgetAccount: async () => undefined }));
jest.mock('@/mail/session', () => ({ closeSession: async () => undefined }));
jest.mock('@/accounts/store', () => ({
  getAccounts: () => [],
  subscribeAccounts: () => () => undefined,
}));
// Argon2 at its real cost takes seconds in a test; what matters here is that the same passphrase finds the same slot.
jest.mock('@/vault/crypto', () => {
  const actual = jest.requireActual('@/vault/crypto');
  const { sha256 } = jest.requireActual('@noble/hashes/sha2.js');
  const { hkdf } = jest.requireActual('@noble/hashes/hkdf.js');
  const { bytesToHex } = jest.requireActual('@noble/hashes/utils.js');
  const text = (value: string) => new TextEncoder().encode(value);
  const part = (key: Uint8Array, info: string): Uint8Array => hkdf(sha256, key, undefined, text(info), 32);
  return {
    ...actual,
    passphraseLocation: async (passphrase: string, email: string) => {
      const key = sha256(text(`${passphrase}\n${email}`));
      return { id: bytesToHex(part(key, 'id')), auth: bytesToHex(part(key, 'auth')), enc: part(key, 'enc') };
    },
  };
});
jest.mock('@/vault/gateway', () => ({
  readBlob: async (_: string, { id }: { id: string }) => (mockDeleted.has(id) ? 'deleted' : (mockBlobs.get(id) ?? null)),
  writeBlob: async (_: string, { id }: { id: string }, version: number, data: Uint8Array) => {
    if ((mockBlobs.get(id)?.version ?? 0) !== version) return false;
    mockBlobs.set(id, { data, version: version + 1 });
    return true;
  },
  deleteBlob: async (_: string, { id }: { id: string }) => {
    mockBlobs.delete(id);
    mockDeleted.add(id);
  },
}));

const GATEWAY = 'https://sync.test';
const setUp = () => unlockWithPassphrase(GATEWAY, 'alice@mailbowox.test', 'a long passphrase', true);
const vaultId = () => vaultLocation(hexToBytes(mockSecrets.get('vault.key')!)).id;

beforeEach(() => {
  mockBlobs.clear();
  mockDeleted.clear();
  mockSecrets.clear();
  mockToasts.length = 0;
});

describe('a vault', () => {
  it('is written again when the sync server lost it', async () => {
    await setUp();
    const id = vaultId();
    mockBlobs.delete(id);

    await syncVault();

    expect(mockBlobs.has(id)).toBe(true);
    expect(mockSecrets.has('vault.key')).toBe(true);
  });

  it('turns sync off here, and is not written back, once another device deleted it', async () => {
    await setUp();
    const id = vaultId();
    mockBlobs.delete(id);
    mockDeleted.add(id);

    await syncVault();

    expect(mockBlobs.has(id)).toBe(false);
    expect(mockSecrets.has('vault.key')).toBe(false);
    expect(mockToasts).toHaveLength(1);
  });

  it('is deleted for every device, and the same passphrase then starts a new one under a new key', async () => {
    await setUp();
    const id = vaultId();
    const key = mockSecrets.get('vault.key');

    await deleteVault();
    expect(mockDeleted.has(id)).toBe(true);
    expect(mockSecrets.has('vault.key')).toBe(false);

    await expect(unlockWithPassphrase(GATEWAY, 'alice@mailbowox.test', 'a long passphrase', false)).rejects.toThrow();

    await setUp();
    expect(mockSecrets.get('vault.key')).not.toBe(key);
    expect(mockBlobs.has(vaultId())).toBe(true);
  });
});
