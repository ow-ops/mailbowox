import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import '@/push/poll';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn() }));
jest.mock('expo-background-task', () => ({ BackgroundTaskResult: { Success: 1 }, registerTaskAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn() }));
jest.mock('@/accounts/store', () => ({
  getAccounts: () => [
    { id: 'polled', email: 'me@example.com' },
    { id: 'pushed', email: 'push@example.com' },
    { id: 'quiet', email: 'quiet@example.com' },
  ],
}));
jest.mock('@/mail/new-mail', () => ({ notifiesNewMail: (id: string) => id !== 'quiet', markNotifyNewMail: jest.fn() }));
jest.mock('@/push/register', () => ({ isPushOn: (id: string) => id === 'pushed' }));
jest.mock('@/push/config', () => ({ ANDROID_CHANNEL: 'mail' }));
jest.mock('@/push/payload', () => ({ accountHash: async (email: string) => `hash of ${email}` }));
jest.mock('@/mail/sync', () => ({ PAGE_SIZE: 50 }));
jest.mock('@/mail/session', () => ({ withSession: (account: string, run: (s: unknown) => unknown) => run(account) }));
jest.mock('@/mail/store', () => {
  const store = {
    syncMailbox: jest.fn(async (account: string) => ({
      reset: false,
      truncated: false,
      arrived: [{ subject: `Hello from ${account}`, from: [{ name: 'Bob', email: 'bob@example.com' }] }],
    })),
  };
  return { mailStore: async () => store, store };
});

const run = jest.mocked(TaskManager.defineTask).mock.calls[0][1] as () => Promise<unknown>;
const { store } = jest.requireMock<{ store: { syncMailbox: jest.Mock } }>('@/mail/store');

describe('the background check', () => {
  it('syncs each inbox that has no push and tells of what arrived', async () => {
    await run();
    expect(store.syncMailbox.mock.calls.map((call) => call[1])).toEqual(['polled']);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0].content).toMatchObject({
      title: 'Bob',
      body: 'Hello from polled',
      data: { account: 'hash of me@example.com' },
    });
  });
});
