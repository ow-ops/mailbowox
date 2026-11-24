import { createStore, useStore } from 'zustand';

import type { Account } from '@/accounts/store';
import type { Category, ListFilter } from '@/core';

import { boxesOf, INBOX, type MailView } from './view';

export type FilterKey = 'unread' | 'flagged' | 'toMe' | 'ccMe' | 'attachments' | 'today';

export const FILTER_KEYS: FilterKey[] = ['unread', 'flagged', 'toMe', 'ccMe', 'attachments', 'today'];

const filters = createStore<Record<FilterKey, boolean>>(() => ({
  unread: false,
  flagged: false,
  toMe: false,
  ccMe: false,
  attachments: false,
  today: false,
}));

export const useFilters = () => useStore(filters);

export const toggleFilter = (key: FilterKey) => filters.setState({ [key]: !filters.getState()[key] });

export const isFiltered = (on: Record<FilterKey, boolean>) => FILTER_KEYS.some((key) => on[key]);

export const ownAddresses = (account: Account) => [account.email, ...(account.identities ?? []).map((i) => i.email)];

const startOfToday = () => Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

// "Me" is any address of any account: mail written to one of your identities counts too.
export function listFilter(on: Record<FilterKey, boolean>, accounts: Account[], category?: Category): ListFilter {
  const { unread, flagged, toMe, ccMe, attachments, today } = on;
  const me = toMe || ccMe ? accounts.flatMap(ownAddresses) : [];
  return { unread, flagged, toMe, ccMe, attachments, me, since: today ? startOfToday() : undefined, category };
}

const hiddenAccounts = createStore<{ hidden: string[] }>(() => ({ hidden: [] }));

export const useHiddenAccounts = () => useStore(hiddenAccounts, (state) => state.hidden);

export const toggleAccount = (id: string) =>
  hiddenAccounts.setState(({ hidden }) => ({
    hidden: hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id],
  }));

// Hiding narrows the views across accounts; a mailbox belongs to one account and shows whatever is hidden.
export function shownBoxes(view: MailView, accounts: Account[], hidden: string[]) {
  const shown = accounts.filter((account) => !hidden.includes(account.id));
  return boxesOf(view, shown.length > 0 ? shown : accounts);
}

export type CategoryChoice = Category | 'all';

export const CATEGORY_CHOICES: CategoryChoice[] = ['primary', 'transactions', 'updates', 'promotions', 'all'];

const chosenCategory = createStore<{ choice: CategoryChoice }>(() => ({ choice: 'primary' }));

export const useCategoryChoice = () => useStore(chosenCategory, (state) => state.choice);

export const chooseCategory = (choice: CategoryChoice) => chosenCategory.setState({ choice });

// Categories sort what arrives: the inbox views have them, folders and the unread view don't.
export const hasCategories = (view: MailView) =>
  view.kind === 'unified' || (view.kind === 'mailbox' && view.mailbox === INBOX);
