import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';

import { syncContactsOf, useContactsSync } from '@/contacts/sync';
import { isOnline } from '@/utils/network';
import { queryClient } from '@/utils/query-client';

jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/hooks/use-app-active', () => ({ useAppActive: () => true }));
jest.mock('@/accounts/store', () => {
  const accounts = [{ id: 'a', carddav: 'https://example.test/dav/' }, { id: 'b' }];
  return {
    getAccount: (id: string) => accounts.find((account) => account.id === id),
    getAccounts: () => accounts,
    useAccounts: () => accounts,
    accountConfig: async () => ({}),
    accountExists: () => true,
  };
});
jest.mock('@/mail/store', () => {
  const store = { syncContacts: jest.fn(), deleteAccount: jest.fn() };
  return { store, mailStore: async () => store };
});

const { store } = jest.requireMock<{ store: { syncContacts: jest.Mock } }>('@/mail/store');
const routeFocused = jest.mocked(useIsFocused);
const setConnected = (isConnected: boolean) => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected });
  jest.mocked(Network.addNetworkStateListener).mock.lastCall?.[0]({ isConnected });
};
const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

afterEach(() => {
  queryClient.clear();
  store.syncContacts.mockReset();
  setConnected(true);
});

it('shares a contact sync between route focus and an explicit request', async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  store.syncContacts.mockReturnValue(promise);
  routeFocused.mockReturnValue(false);
  const { result, rerender } = await renderHook(useContactsSync, { wrapper });
  expect(store.syncContacts).not.toHaveBeenCalled();

  routeFocused.mockReturnValue(true);
  await rerender(undefined);
  await waitFor(() => expect(store.syncContacts).toHaveBeenCalledTimes(1));
  expect(result.current.syncing).toBe(true);

  await act(async () => {
    const refresh = syncContactsOf('a');
    resolve();
    await refresh;
  });

  await waitFor(() => expect(result.current.syncing).toBe(false));
  expect(store.syncContacts).toHaveBeenCalledTimes(1);
  expect(store.syncContacts).toHaveBeenCalledWith({}, 'a', 'https://example.test/dav/');
});

it('waits while offline and syncs focused contacts on reconnect', async () => {
  setConnected(false);
  routeFocused.mockReturnValue(true);
  const failure = new Error('CardDAV server unavailable');
  store.syncContacts.mockRejectedValue(failure);
  const { result } = await renderHook(useContactsSync, { wrapper });

  expect(isOnline()).toBe(false);
  await syncContactsOf('a');
  expect(store.syncContacts).not.toHaveBeenCalled();

  await act(() => setConnected(true));
  await waitFor(() => expect(result.current.errors.a).toBe(failure));
  expect(store.syncContacts).toHaveBeenCalledTimes(1);
});
