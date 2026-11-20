import { accountConfig, addAccount, getAccounts, restoreAccount, syncedAccount } from '@/accounts/store';
import type { AccountConfig } from '@/core';

const mockItems = new Map<string, string>();

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockItems.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockItems.set(key, value),
    removeItemSync: (key: string) => mockItems.delete(key),
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => 'secret',
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const config: AccountConfig = {
  email: 'alice@mailbowox.test',
  displayName: 'Alice',
  imap: { host: 'imap.test', port: 993, security: 'tls' },
  smtp: { host: 'smtp.test', port: 465, security: 'tls' },
  credentials: { username: 'alice@mailbowox.test', password: 'secret' },
  carddavUrl: 'https://carddav.example.com',
};

describe('account servers synced through the vault', () => {
  it('hands the CardDAV address to the vault with the rest of the account', async () => {
    const account = await addAccount(config, { carddav: 'https://carddav.example.com/home/' });
    expect(await accountConfig(account)).toEqual(config);
  });

  it('takes the CardDAV address from another device but keeps the address book this device found', async () => {
    await restoreAccount({ ...config, carddavUrl: 'https://contacts.example.net' }, Date.now() + 1);
    const [account] = getAccounts();
    expect(account.carddavUrl).toBe('https://contacts.example.net');
    expect(account.carddav).toBe('https://carddav.example.com/home/');
  });

  it('keeps the calendar URL in a vault shared with an older app', async () => {
    const caldavUrl = 'https://caldav.example.com';
    await restoreAccount({ ...config, caldavUrl }, Date.now() + 1);
    const [account] = getAccounts();
    expect(await accountConfig(account)).toEqual(config);
    expect(await syncedAccount(account)).toEqual({ ...config, caldavUrl });
  });
});
