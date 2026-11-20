import * as v from 'valibot';
import { createStore, useStore } from 'zustand';

import { forgetAccount } from '@/accounts/forget';
import { getPassword } from '@/accounts/secrets';
import { getAccounts, restoreAccount, subscribeAccounts, syncedAccount } from '@/accounts/store';
import { t } from '@/i18n';
import { closeSession } from '@/mail/session';
import { getSyncedPrefs, restorePrefs, subscribePrefs } from '@/prefs/store';
import { writeItem } from '@/utils/kv';
import { readJson } from '@/utils/stored';
import { applyRelay } from '@/utils/relay';
import { showError } from '@/utils/toast';

import { createVaultKey, open, passphraseLocation, seal, vaultLocation } from './crypto';
import { decodeDocument, encodeDocument, mergeDocuments, type VaultDocument } from './document';
import { deleteBlob, readBlob, writeBlob } from './gateway';
import { deleteVaultKey, loadVaultKey, saveVaultKey } from './key';

type VaultState = {
  gateway: string | null;
  syncedAt: number | null;
  syncing: boolean;
  error: string | null;
};

const KEY = 'vault';
const REMOVED_KEY = 'vault.removed';

function load(): VaultState {
  const unset = { gateway: null, syncedAt: null };
  const saved = readJson(KEY, v.object({ gateway: v.nullable(v.string()), syncedAt: v.nullable(v.number()) }), unset);
  return { ...saved, syncing: false, error: null };
}

const vaultStore = createStore<VaultState>(load);

vaultStore.subscribe(({ gateway, syncedAt }) => writeItem(KEY, JSON.stringify({ gateway, syncedAt })));

export const useVault = () => useStore(vaultStore);

const getGateway = () => vaultStore.getState().gateway;

const readRemovals = (): Record<string, number> => readJson(REMOVED_KEY, v.record(v.string(), v.number()), {});

export function recordRemoval(email: string) {
  writeItem(REMOVED_KEY, JSON.stringify({ ...readRemovals(), [email.toLowerCase()]: Date.now() }));
}

function clearRemovals(pushed: VaultDocument) {
  const left = Object.entries(readRemovals()).filter(([email, at]) => pushed.accounts[email]?.updatedAt !== at);
  writeItem(REMOVED_KEY, JSON.stringify(Object.fromEntries(left)));
}

async function localDocument(): Promise<VaultDocument> {
  const accounts: VaultDocument['accounts'] = {};
  for (const [email, at] of Object.entries(readRemovals())) accounts[email] = { updatedAt: at, account: null };
  for (const account of getAccounts()) {
    // An account whose password this device lost has nothing to add, and must not stop the others syncing:
    // it is left out, and the vault's copy brings the password back.
    if ((await getPassword(account.id)) === null) continue;
    accounts[account.email.toLowerCase()] = { updatedAt: account.updatedAt ?? 0, account: await syncedAccount(account) };
  }
  return { accounts, prefs: getSyncedPrefs() };
}

async function applyDocument(document: VaultDocument) {
  for (const [email, entry] of Object.entries(document.accounts)) {
    const local = getAccounts().find((a) => a.email.toLowerCase() === email);
    if (!entry.account) {
      if (local) await forgetAccount(local);
      continue;
    }
    const current = local && (local.updatedAt ?? 0) >= entry.updatedAt && (await getPassword(local.id)) !== null;
    if (current) continue;
    if (local) await closeSession(local.id);
    await restoreAccount(entry.account, entry.updatedAt);
  }
  if (document.prefs.updatedAt > getSyncedPrefs().updatedAt) {
    restorePrefs(document.prefs.value, document.prefs.updatedAt);
    applyRelay();
  }
}

function unseal(key: Uint8Array, data: Uint8Array) {
  try {
    return open(key, data);
  } catch {
    throw new Error(t('settings.devices.errors.decrypt'));
  }
}

const MAX_ATTEMPTS = 3;

async function syncOnce(gateway: string, key: Uint8Array) {
  const location = vaultLocation(key);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remote = await readBlob(gateway, location);
    // Another device deleted the vault: sync ends here too, and nothing is written back. A vault the server
    // merely lost reads as absent instead, and is written again below.
    if (remote === 'deleted') {
      await turnOffVault();
      showError(t('settings.devices.errors.deleted'));
      return;
    }
    const local = await localDocument();
    const merged = remote ? mergeDocuments(local, decodeDocument(unseal(location.enc, remote.data))) : null;
    const document = merged?.document ?? local;
    await applyDocument(document);
    if (merged && !merged.changed) return;
    if (await writeBlob(gateway, location, remote?.version ?? 0, seal(location.enc, encodeDocument(document)))) {
      clearRemovals(document);
      return;
    }
  }
  throw new Error(t('settings.devices.errors.busy'));
}

let running: Promise<void> | null = null;
let again = false;

async function run() {
  vaultStore.setState({ syncing: true });
  try {
    do {
      again = false;
      const gateway = getGateway();
      const key = await loadVaultKey();
      if (!gateway || !key) return;
      await syncOnce(gateway, key);
    } while (again);
    // Unless this sync found the vault deleted and turned sync off.
    if (getGateway()) vaultStore.setState({ syncedAt: Date.now(), error: null });
  } catch (error) {
    vaultStore.setState({ error: (error as Error).message });
    throw error;
  } finally {
    running = null;
    vaultStore.setState({ syncing: false });
  }
}

// Calls made during a sync share it, and it runs once more to pick up what they changed.
export function syncVault() {
  if (running) {
    again = true;
    return running;
  }
  running = run();
  return running;
}

// The error is kept in the vault state and shown in Settings.
const syncInBackground = () => {
  if (getGateway()) syncVault().catch(() => undefined);
};

export function watchVault() {
  syncInBackground();
  const unsubscribeAccounts = subscribeAccounts(syncInBackground);
  const unsubscribePrefs = subscribePrefs(syncInBackground);
  return () => {
    unsubscribeAccounts();
    unsubscribePrefs();
  };
}

export const normalizeGateway = (url: string) => url.trim().replace(/\/+$/, '');

export async function joinWithKey(gateway: string, key: Uint8Array) {
  await saveVaultKey(key);
  vaultStore.setState({ gateway, syncedAt: null, error: null });
  await syncVault();
}

// Joins the vault behind this passphrase, or creates one when `create` is set and none exists yet.
export async function unlockWithPassphrase(gateway: string, email: string, passphrase: string, create: boolean) {
  const slot = await passphraseLocation(passphrase, email);
  const existing = await readBlob(gateway, slot);
  if (existing === 'deleted') throw new Error(t('settings.devices.errors.deleted'));
  if (existing) {
    const key = unseal(slot.enc, existing.data);
    if ((await readBlob(gateway, vaultLocation(key))) !== 'deleted') return joinWithKey(gateway, key);
    // The vault this passphrase opened was deleted. Setting sync up again starts a new one, under a new
    // key that replaces the old one in the slot.
    if (!create) throw new Error(t('settings.devices.errors.deleted'));
  } else if (!create) {
    throw new Error(t('settings.devices.errors.noVault'));
  }
  const key = createVaultKey();
  if (!(await writeBlob(gateway, slot, existing?.version ?? 0, seal(slot.enc, key)))) {
    throw new Error(t('settings.devices.errors.busy'));
  }
  return joinWithKey(gateway, key);
}

// Deletes the synced copy for every device, then turns sync off here. The other devices turn theirs off
// when they next sync; the accounts stay on each of them.
export async function deleteVault() {
  const gateway = getGateway();
  const key = await loadVaultKey();
  if (gateway && key) await deleteBlob(gateway, vaultLocation(key));
  await turnOffVault();
}

export async function turnOffVault() {
  await deleteVaultKey();
  vaultStore.setState({ gateway: null, syncedAt: null, error: null });
}
