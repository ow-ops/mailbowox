import { queryOptions, useQueries } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { accountConfig, accountExists, getAccount, getAccounts, useAccounts } from '@/accounts/store';
import { core } from '@/core';
import { useAppActive } from '@/hooks/use-app-active';
import { isOnline, useOnline } from '@/utils/network';
import { invalidateContacts, queryClient } from '@/utils/query-client';
import { settleAll } from '@/utils/settle';

import { applyContactSync, getSyncInput, saveAddressBooks, type BookRef } from './db';

async function run(accountId: string) {
  const account = getAccount(accountId);
  if (!account.carddav) return null;
  const config = await accountConfig(account);
  const books = await core.listAddressBooks(config, account.carddav);
  // Removed while the server was answering: nothing more is written for it.
  if (!accountExists(accountId)) return null;
  await saveAddressBooks(accountId, books);
  // One address book at a time: servers such as Stalwart cap concurrent requests per account.
  let failure: unknown;
  for (const book of books) {
    const ref: BookRef = { account: accountId, book: book.href };
    await getSyncInput(ref)
      .then(({ state, known }) => core.syncContacts(config, book.href, state, known))
      .then((result) => (accountExists(accountId) ? applyContactSync(ref, result) : undefined))
      .catch((error: unknown) => {
        failure ??= error;
      });
  }
  invalidateContacts();
  if (failure) throw failure;
  return null;
}

const syncQuery = (accountId: string) =>
  queryOptions({
    queryKey: ['contact-sync', accountId],
    queryFn: () => run(accountId),
    networkMode: 'online',
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export async function syncContactsOf(accountId: string) {
  if (isOnline()) await queryClient.fetchQuery(syncQuery(accountId));
}

export const syncContacts = () =>
  settleAll(getAccounts().filter((account) => account.carddav).map((account) => syncContactsOf(account.id)));

export function useContactsSync() {
  const accounts = useAccounts().filter((account) => account.carddav);
  const focused = useIsFocused();
  const active = useAppActive();
  const online = useOnline();
  const syncs = useQueries({
    queries: accounts.map(({ id }) => ({ ...syncQuery(id), enabled: focused && active && online })),
  });
  return {
    syncing: syncs.some((sync) => sync.isFetching),
    errors: Object.fromEntries(accounts.map(({ id }, index) => [id, syncs[index].error])),
  };
}
