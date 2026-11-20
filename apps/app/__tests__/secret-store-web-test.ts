/** @jest-environment node */
import { deleteSecret, getSecret, setSecret } from '@/utils/secret-store.web';

const mockIdb = new Map<string, unknown>();
const mockStorage = new Map<string, string>();

jest.mock('idb-keyval', () => ({
  get: async (key: string) => mockIdb.get(key),
  update: async (key: string, updater: (old: unknown) => unknown) => void mockIdb.set(key, updater(mockIdb.get(key))),
}));

const { webcrypto } = jest.requireActual<{ webcrypto: Crypto }>('crypto');

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
    },
  });
});

describe('web secret store', () => {
  it('keeps the secret out of localStorage in plain text', async () => {
    await setSecret('password.a', 'hunter2');
    expect(mockStorage.get('password.a')).not.toContain('hunter2');
    expect(await getSecret('password.a')).toBe('hunter2');
  });

  it('uses a non-extractable key', async () => {
    await setSecret('password.a', 'hunter2');
    const key = mockIdb.get('secret-store.key') as CryptoKey;
    expect(key.extractable).toBe(false);
  });

  it('refuses ciphertext moved to another entry', async () => {
    await setSecret('password.a', 'hunter2');
    mockStorage.set('password.b', mockStorage.get('password.a')!);
    expect(await getSecret('password.b')).toBeNull();
  });

  it('reads an entry as missing once its key is gone', async () => {
    await setSecret('password.a', 'hunter2');
    const stored = mockStorage.get('password.a')!;
    jest.resetModules();
    mockIdb.clear();
    const fresh = require('@/utils/secret-store.web') as typeof import('@/utils/secret-store.web');
    mockStorage.set('password.a', stored);
    expect(await fresh.getSecret('password.a')).toBeNull();
  });

  it('forgets a deleted secret', async () => {
    await setSecret('password.a', 'hunter2');
    await deleteSecret('password.a');
    expect(await getSecret('password.a')).toBeNull();
  });
});
