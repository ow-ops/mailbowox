import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';

import { getAddressBooks, saveAddressBooks } from '@/contacts/db';
import { syncContactsOf, useContactsSync } from '@/contacts/sync';
import { core } from '@/core';
import { isOnline } from '@/utils/network';
import { queryClient } from '@/utils/query-client';

jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));
jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));
jest.mock('@/hooks/use-app-active', () => ({ useAppActive: () => true }));
jest.mock('@/accounts/store', () => {
  const accounts = [{ id: 'a', carddav: 'https://example.test/dav/' }, { id: 'b' }];
  return {
    getAccount: (id: string) => accounts.find((account) => account.id === id),
    useAccounts: () => accounts,
    accountConfig: async () => ({}),
    accountExists: () => true,
  };
});
jest.mock('@/core', () => ({
  core: {
    listAddressBooks: jest.fn(),
    syncContacts: jest.fn(async () => ({ state: {}, reset: false, changed: [], removed: [] })),
  },
}));

const listBooks = jest.mocked(core.listAddressBooks);
const routeFocused = jest.mocked(useIsFocused);
const setConnected = (isConnected: boolean) => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected });
  jest.mocked(Network.addNetworkStateListener).mock.lastCall?.[0]({ isConnected });
};
const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

afterEach(() => {
  queryClient.clear();
  listBooks.mockReset();
  setConnected(true);
});

it('shares a contact sync between route focus and an explicit request', async () => {
  const { promise, resolve } = Promise.withResolvers<Awaited<ReturnType<typeof core.listAddressBooks>>>();
  listBooks.mockReturnValue(promise);
  routeFocused.mockReturnValue(false);
  const { result, rerender } = await renderHook(useContactsSync, { wrapper });
  expect(listBooks).not.toHaveBeenCalled();

  routeFocused.mockReturnValue(true);
  await rerender(undefined);
  await waitFor(() => expect(listBooks).toHaveBeenCalledTimes(1));
  expect(result.current.syncing).toBe(true);

  await act(async () => {
    const refresh = syncContactsOf('a');
    resolve([{ href: 'https://example.test/dav/book/', name: 'Personal', readOnly: false }]);
    await refresh;
  });

  await waitFor(() => expect(result.current.syncing).toBe(false));
  expect(listBooks).toHaveBeenCalledTimes(1);
  expect(await getAddressBooks()).toEqual([expect.objectContaining({ account: 'a', name: 'Personal' })]);
});

it('keeps local queries and mutations usable offline and syncs focused contacts on reconnect', async () => {
  setConnected(false);
  routeFocused.mockReturnValue(true);
  const failure = new Error('CardDAV server unavailable');
  listBooks.mockRejectedValue(failure);
  const { result } = await renderHook(useContactsSync, { wrapper });

  expect(isOnline()).toBe(false);
  await syncContactsOf('a');
  expect(listBooks).not.toHaveBeenCalled();
  const book = { href: 'https://example.test/dav/offline/', name: 'Offline', readOnly: false };
  const localWrite = queryClient.getMutationCache().build(queryClient, {
    mutationFn: () => saveAddressBooks('a', [book]),
    gcTime: Infinity,
  });
  await localWrite.execute(undefined);
  const books = await queryClient.fetchQuery({ queryKey: ['contacts', 'books'], queryFn: getAddressBooks });
  expect(books).toEqual([expect.objectContaining({ account: 'a', name: 'Offline' })]);

  await act(() => setConnected(true));
  await waitFor(() => expect(result.current.errors.a).toBe(failure));
  expect(listBooks).toHaveBeenCalledTimes(1);
});
