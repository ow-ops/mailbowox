import { announceNewMail, setNotifyNewMail } from '@/mail/new-mail';
import type { MessageSummary } from '@/core';

const mockInvoke = jest.fn(async (..._args: unknown[]) => undefined);
const mockStore = new Map<string, string>();
const imap = { host: 'imap.example.org', port: 993, security: 'tls' };

jest.mock('@/utils/desktop', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));
jest.mock('@/utils/kv', () => ({
  readItem: (key: string) => mockStore.get(key) ?? null,
  writeItem: (key: string, value: string) => mockStore.set(key, value),
  removeItem: (key: string) => mockStore.delete(key),
}));
jest.mock('@/i18n', () => ({ t: (key: string) => key }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@/accounts/store', () => {
  const accounts = [
    { id: 'a1', email: 'alice@example.org', username: 'alice', imap: { host: 'imap.example.org', port: 993, security: 'tls' } },
    { id: 'a2', email: 'bob@example.org', username: 'bob', imap: { host: 'imap.example.org', port: 993, security: 'tls' } },
  ];
  return {
    getAccounts: () => accounts,
    getAccount: (id: string) => accounts.find((account) => account.id === id),
    accountConfig: async (account: { id: string; username: string; imap: unknown }) => {
      if (account.id === 'a2') throw new Error('missing password');
      return { imap: account.imap, credentials: { username: account.username, password: 'pw' } };
    },
  };
});

const requestPermission = jest.fn();
const shown = jest.fn();
Object.assign(globalThis, { Notification: Object.assign(shown, { requestPermission, permission: 'granted' }) });

beforeEach(() => {
  mockStore.clear();
  mockInvoke.mockClear();
  shown.mockClear();
});

describe('notifications in the desktop shell', () => {
  it('hands the shell each account that shows new mail, with its password, and asks no permission', async () => {
    await setNotifyNewMail('a1', true);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenLastCalledWith('watch_inboxes', {
      accounts: [{ id: 'a1', imap, username: 'alice', password: 'pw' }],
    });

    await setNotifyNewMail('a1', false);
    expect(mockInvoke).toHaveBeenLastCalledWith('watch_inboxes', { accounts: [] });
  });

  it('leaves out an account whose password is missing', async () => {
    await setNotifyNewMail('a1', true);
    await setNotifyNewMail('a2', true);

    expect(mockInvoke).toHaveBeenLastCalledWith('watch_inboxes', {
      accounts: [{ id: 'a1', imap, username: 'alice', password: 'pw' }],
    });
  });

  it('leaves new mail to the shell instead of the browser', async () => {
    await setNotifyNewMail('a1', true);
    jest.spyOn(document, 'hasFocus').mockReturnValue(false);

    announceNewMail('a1', [{ uid: 5, subject: 'Lunch?', from: [{ email: 'bob@example.org' }] } as MessageSummary]);

    expect(shown).not.toHaveBeenCalled();
  });
});
