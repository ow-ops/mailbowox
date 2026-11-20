import { renderHook, waitFor } from '@testing-library/react-native';

import { disablePush, dropPush, enablePush, isPushOn, retryUnregistrations, syncPush } from '@/push/register';
import { usePushSync } from '@/push/use-push-sync';

const mockStore = new Map<string, string>();

jest.mock('@/utils/kv', () => ({
  readItem: (key: string) => mockStore.get(key) ?? null,
  writeItem: (key: string, value: string) => mockStore.set(key, value),
  removeItem: (key: string) => mockStore.delete(key),
}));
jest.mock('@/push/config', () => ({ GATEWAY_URL: 'https://gateway.test', ANDROID_CHANNEL: 'mail' }));
jest.mock('@/hooks/use-app-active', () => ({ useAppActive: () => true }));
jest.mock('@/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/accounts/store', () => ({
  accountConfig: async () => ({
    email: 'alice@example.org',
    imap: { host: 'imap.example.org', port: 993, security: 'tls' },
    credentials: { username: 'alice', password: 'pw' },
  }),
}));
jest.mock('expo-application', () => ({
  getIosPushNotificationServiceEnvironmentAsync: async () => 'production',
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: async () => undefined,
  requestPermissionsAsync: async () => ({ granted: true }),
  getDevicePushTokenAsync: async () => ({ data: 'abcd' }),
}));

const account = { id: 'a1' } as Parameters<typeof enablePush>[0];
const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

beforeEach(() => {
  mockStore.clear();
  fetchMock.mockReset();
});

describe('push registration', () => {
  it('keeps the secret the gateway issues and presents it to unregister', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'r1', secret: 's3cret' }, { status: 201 }));
    await enablePush(account);
    expect(isPushOn('a1')).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await disablePush(account);
    expect(fetchMock).toHaveBeenLastCalledWith('https://gateway.test/push/r1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer s3cret' },
    });
    expect(isPushOn('a1')).toBe(false);
  });

  it('reads a saved registration without a secret as off', () => {
    mockStore.set('push.a1', JSON.stringify({ id: 'old', platform: 'ios', token: 'abcd' }));
    expect(isPushOn('a1')).toBe(false);
  });

  describe('removing an account while the gateway is out of reach', () => {
    beforeEach(() => mockStore.set('push.a1', JSON.stringify({ id: 'r1', secret: 's', platform: 'ios', token: 'abcd' })));

    it('retries at startup after the last account was removed', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      await dropPush(account);
      expect(isPushOn('a1')).toBe(false);

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
      await retryUnregistrations();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await renderHook(() => usePushSync(false));
      await waitFor(() => expect(mockStore.get('push.unregister')).toBe('[]'));
      expect(fetchMock).toHaveBeenLastCalledWith('https://gateway.test/push/r1', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer s' },
      });

      fetchMock.mockClear();
      await retryUnregistrations();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('leaves a current registration alone at start', async () => {
    mockStore.set('push.a1', JSON.stringify({ id: 'r1', secret: 's', platform: 'ios', token: 'abcd' }));

    await syncPush(account);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
