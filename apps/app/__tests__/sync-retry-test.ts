import { act, renderHook, waitFor } from '@testing-library/react-native';

import { retrySync, useSyncErrors, useWatchMailbox } from '@/mail/sync';
import { withSession } from '@/mail/session';

jest.mock('expo-router', () => require('../jest/expo-router'));
jest.mock('@/mail/session', () => ({ withSession: jest.fn() }));
jest.mock('@/mail/db', () => ({}));
jest.mock('@/utils/query-client', () => ({ queryClient: {}, invalidateMail: jest.fn() }));
jest.mock('@/accounts/store', () => ({}));
jest.mock('@/core', () => ({ core: {} }));
jest.mock('@/hooks/use-app-active', () => ({ useAppActive: () => true }));
jest.mock('@/utils/network', () => ({ isOnline: () => true, useOnline: () => true }));

const attempts = withSession as jest.Mock;
const unreachable = () => Object.assign(new Error('Connection refused'), { tag: 'Network' });

beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
afterEach(() => jest.useRealTimers());

describe('retrySync', () => {
  it('cuts a failed watcher backoff short and resolves with its next attempt', async () => {
    attempts.mockRejectedValue(unreachable());
    const { result, unmount } = await renderHook(() => {
      useWatchMailbox('a', 'INBOX');
      return useSyncErrors();
    });
    await waitFor(() => expect(result.current.a).toBeDefined());
    expect(attempts).toHaveBeenCalledTimes(1);

    const second = unreachable();
    attempts.mockRejectedValue(second);
    await act(() => retrySync(['a']));

    expect(attempts).toHaveBeenCalledTimes(2);
    expect(result.current.a).toBe(second);
    await unmount();
  });

  it('leaves the watchers of other accounts in their backoff', async () => {
    attempts.mockRejectedValue(unreachable());
    const { result, unmount } = await renderHook(() => {
      useWatchMailbox('b', 'INBOX');
      return useSyncErrors();
    });
    await waitFor(() => expect(result.current.b).toBeDefined());
    attempts.mockClear();

    void retrySync(['a']);
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(attempts).not.toHaveBeenCalled();
    await unmount();
  });
});
