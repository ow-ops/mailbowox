import { createStore, useStore } from 'zustand';

import { useAccounts, type Account } from '@/accounts/store';

import type { MailboxRef } from './refs';

export const INBOX = 'INBOX';

// `unified` is All inboxes and `unread` the unread mail in them.
export type MailView = { kind: 'unified' } | { kind: 'unread' } | ({ kind: 'mailbox' } & MailboxRef);

const viewStore = createStore<{ view: MailView | null }>(() => ({ view: null }));

export const setMailView = (view: MailView) => viewStore.setState({ view });

const stillValid = (view: MailView, accounts: Account[]) =>
  view.kind === 'mailbox' ? accounts.some((a) => a.id === view.account) : accounts.length > 1;

// All inboxes when there are several accounts, else the one inbox, until the user picks a mailbox.
export function useMailView(): MailView {
  const accounts = useAccounts();
  const chosen = useStore(viewStore, (state) => state.view);
  if (chosen && stillValid(chosen, accounts)) return chosen;
  return accounts.length > 1 ? { kind: 'unified' } : { kind: 'mailbox', account: accounts[0].id, mailbox: INBOX };
}

// The account whose mail is shown, for its own theme: none in the views that mix accounts, or before sign-in.
export function useShownAccount(): Account | undefined {
  const accounts = useAccounts();
  const chosen = useStore(viewStore, (state) => state.view);
  if (chosen && stillValid(chosen, accounts)) {
    return chosen.kind === 'mailbox' ? accounts.find((a) => a.id === chosen.account) : undefined;
  }
  return accounts.length === 1 ? accounts[0] : undefined;
}

export const boxesOf = (view: MailView, accounts: Account[]): MailboxRef[] =>
  view.kind === 'mailbox' ? [view] : accounts.map((a) => ({ account: a.id, mailbox: INBOX }));

export const sameView = (a: MailView, b: MailView) =>
  a.kind === 'mailbox'
    ? b.kind === 'mailbox' && a.account === b.account && a.mailbox === b.mailbox
    : a.kind === b.kind;
