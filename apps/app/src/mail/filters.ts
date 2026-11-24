import { createStore, useStore } from 'zustand';

import type { Account } from '@/accounts/store';
import type { ListFilter } from '@/core';

export type FilterKey = 'unread' | 'flagged' | 'toMe' | 'attachments';

export const FILTER_KEYS: FilterKey[] = ['unread', 'flagged', 'toMe', 'attachments'];

const filters = createStore<Record<FilterKey, boolean>>(() => ({ unread: false, flagged: false, toMe: false, attachments: false }));

export const useFilters = () => useStore(filters);

export const toggleFilter = (key: FilterKey) => filters.setState({ [key]: !filters.getState()[key] });

export const isFiltered = (on: Record<FilterKey, boolean>) => FILTER_KEYS.some((key) => on[key]);

// "To me" is any address of any account: mail written to one of your identities counts too.
export function listFilter(on: Record<FilterKey, boolean>, accounts: Account[]): ListFilter {
  const me = accounts.flatMap((account) => [account.email, ...(account.identities ?? []).map((identity) => identity.email)]);
  return { ...on, me: on.toMe ? me : [] };
}
