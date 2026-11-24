import { queryOptions, useQueries } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { accountConfig, accountExists, getAccount, getAccounts, useAccounts } from '@/accounts/store';
import { useAppActive } from '@/hooks/use-app-active';
import { mailStore } from '@/mail/store';
import { isOnline, useOnline } from '@/utils/network';
import { invalidateContacts, queryClient } from '@/utils/query-client';
import { settleAll } from '@/utils/settle';

async function run(accountId: string) {
  const account = getAccount(accountId);
  if (!account.carddav) return null;
  const store = await mailStore();
  try {
    await store.syncContacts(await accountConfig(account), accountId, account.carddav);
  } finally {
    // Removed while the server was answering: its data is being deleted, and this sync put some back.
    if (!accountExists(accountId)) await store.deleteAccount(accountId);
    invalidateContacts();
  }
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
