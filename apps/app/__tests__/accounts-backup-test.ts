import { openBackup, sealBackup } from '@/accounts/backup';
import type { SyncedAccount } from '@/accounts/store';

jest.mock('@/core', () => jest.requireActual('../jest/core'));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
}));

const account: SyncedAccount = {
  email: 'ada@example.org',
  displayName: 'Ada',
  imap: { host: 'imap.example.org', port: 993, security: 'tls' },
  smtp: { host: 'smtp.example.org', port: 465, security: 'tls' },
  credentials: { username: 'ada@example.org', password: 'secret' },
};

describe('account backups', () => {
  it('opens with the password it was sealed with', async () => {
    const file = await sealBackup([account], 'correct horse battery');
    expect(file).not.toContain('secret');
    await expect(openBackup(file, 'correct horse battery')).resolves.toEqual([account]);
  });

  it('refuses another password', async () => {
    const file = await sealBackup([account], 'correct horse battery');
    await expect(openBackup(file, 'wrong horse battery')).rejects.toThrow();
  });

  it('refuses a file that is not a backup', async () => {
    await expect(openBackup('{"mailbowox":"link"}', 'correct horse battery')).rejects.toThrow();
    await expect(openBackup('not json', 'correct horse battery')).rejects.toThrow();
  });
});
