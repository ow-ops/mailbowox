import { createStore, useStore } from 'zustand';

import type { Account } from '@/accounts/store';
import type { Category, ListFilter } from '@/core';

import { INBOX, type MailView } from './view';

export type FilterKey = 'unread' | 'flagged' | 'toMe' | 'attachments';

export const FILTER_KEYS: FilterKey[] = ['unread', 'flagged', 'toMe', 'attachments'];

const filters = createStore<Record<FilterKey, boolean>>(() => ({ unread: false, flagged: false, toMe: false, attachments: false }));

export const useFilters = () => useStore(filters);

export const toggleFilter = (key: FilterKey) => filters.setState({ [key]: !filters.getState()[key] });

export const isFiltered = (on: Record<FilterKey, boolean>) => FILTER_KEYS.some((key) => on[key]);

export const ownAddresses = (account: Account) => [account.email, ...(account.identities ?? []).map((i) => i.email)];

// "To me" is any address of any account: mail written to one of your identities counts too.
export function listFilter(on: Record<FilterKey, boolean>, accounts: Account[], category?: Category): ListFilter {
  return { ...on, me: on.toMe ? accounts.flatMap(ownAddresses) : [], category };
}

export type CategoryChoice = Category | 'all';

export const CATEGORY_CHOICES: CategoryChoice[] = ['primary', 'transactions', 'updates', 'promotions', 'all'];

const chosenCategory = createStore<{ choice: CategoryChoice }>(() => ({ choice: 'primary' }));

export const useCategoryChoice = () => useStore(chosenCategory, (state) => state.choice);

export const chooseCategory = (choice: CategoryChoice) => chosenCategory.setState({ choice });

// Categories sort what arrives: the inbox views have them, folders and the unread view don't.
export const hasCategories = (view: MailView) =>
  view.kind === 'unified' || (view.kind === 'mailbox' && view.mailbox === INBOX);
