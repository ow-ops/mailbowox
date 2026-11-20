import { createStore, useStore } from 'zustand';

import type { AccountConfig, Address, ServerConfig } from '@/core';
import { t } from '@/i18n';
import { readItem, writeItem } from '@/utils/kv';

import { getPassword, removePassword, setPassword } from './secrets';

export type Account = {
  id: string;
  email: string;
  displayName: string;
  username: string;
  imap: ServerConfig;
  smtp: ServerConfig;
  // Kept when syncing with devices that still have a calendar.
  caldavUrl?: string;
  carddavUrl?: string;
  // Extra addresses to send from; the account's own address is always the default.
  identities?: Address[];
  signature?: string;
  carddav?: string;
  // Absent on accounts added before sync existed.
  updatedAt?: number;
};

// What the vault carries for an account: the config the core takes, plus its identities and signature.
export type SyncedAccount = AccountConfig & { caldavUrl?: string; identities?: Address[]; signature?: string };

const KEY = 'accounts';

let readable = true;

function load(): Account[] {
  try {
    return JSON.parse(readItem(KEY) ?? '[]') as Account[];
  } catch {
    readable = false;
    return [];
  }
}

const accountsStore = createStore<{ accounts: Account[] }>(() => ({ accounts: load() }));

// False when the saved list couldn't be read: the accounts are then unknown, not absent.
export const accountsReadable = () => readable;

accountsStore.subscribe(({ accounts }) => writeItem(KEY, JSON.stringify(accounts)));

export const useAccounts = () => useStore(accountsStore, (state) => state.accounts);

export const getAccounts = () => accountsStore.getState().accounts;

export function getAccount(id: string) {
  const account = getAccounts().find((a) => a.id === id);
  if (!account) throw new Error(t('accounts.errors.removed'));
  return account;
}

// False once an account is removed, for work that was already under way to stop writing for it.
export const accountExists = (id: string) => getAccounts().some((a) => a.id === id);

export const hasAccount = (email: string) =>
  getAccounts().some((a) => a.email.toLowerCase() === email.trim().toLowerCase());

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const fromConfig = (
  id: string,
  config: SyncedAccount,
  updatedAt: number,
  homes: { carddav?: string } = {},
): Account => ({
  id,
  email: config.email,
  displayName: config.displayName,
  username: config.credentials.username,
  imap: config.imap,
  smtp: config.smtp,
  caldavUrl: config.caldavUrl,
  carddavUrl: config.carddavUrl,
  ...homes,
  identities: config.identities,
  signature: config.signature,
  updatedAt,
});

export async function addAccount(config: AccountConfig, homes?: { carddav?: string }) {
  const account = fromConfig(newId(), config, Date.now(), homes);
  await setPassword(account.id, config.credentials.password);
  accountsStore.setState({ accounts: [...getAccounts(), account] });
  return account;
}

export function setCarddav(id: string, carddav: string) {
  accountsStore.setState({ accounts: getAccounts().map((a) => (a.id === id ? { ...a, carddav } : a)) });
}

// Adds or replaces the account with this email, as another device last saved it. The address-book home
// is local to this device.
export async function restoreAccount(config: SyncedAccount, updatedAt: number) {
  const email = config.email.toLowerCase();
  const existing = getAccounts().find((a) => a.email.toLowerCase() === email);
  const account = fromConfig(existing?.id ?? newId(), config, updatedAt, {
    carddav: existing?.carddav,
  });
  await setPassword(account.id, config.credentials.password);
  const accounts = existing
    ? getAccounts().map((a) => (a.id === account.id ? account : a))
    : [...getAccounts(), account];
  accountsStore.setState({ accounts });
}

export function setIdentities(id: string, identities: Address[]) {
  accountsStore.setState({
    accounts: getAccounts().map((a) => (a.id === id ? { ...a, identities, updatedAt: Date.now() } : a)),
  });
}

export function setSignature(id: string, signature: string) {
  accountsStore.setState({
    accounts: getAccounts().map((a) => (a.id === id ? { ...a, signature: signature || undefined, updatedAt: Date.now() } : a)),
  });
}

export const subscribeAccounts = (listener: () => void) => accountsStore.subscribe(listener);

export async function removeAccount(id: string) {
  await removePassword(id);
  accountsStore.setState({ accounts: getAccounts().filter((a) => a.id !== id) });
}

export async function accountConfig(account: Account): Promise<AccountConfig> {
  const password = await getPassword(account.id);
  if (password === null) throw new Error(t('accounts.errors.missingPassword', { email: account.email }));
  return {
    email: account.email,
    displayName: account.displayName,
    imap: account.imap,
    smtp: account.smtp,
    credentials: { username: account.username, password },
    carddavUrl: account.carddavUrl,
  };
}

export async function syncedAccount(account: Account): Promise<SyncedAccount> {
  return { ...(await accountConfig(account)), caldavUrl: account.caldavUrl, identities: account.identities, signature: account.signature };
}
