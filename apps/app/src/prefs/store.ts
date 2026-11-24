import * as v from 'valibot';
import { createStore, useStore } from 'zustand';

import { readItem, writeItem } from '@/utils/kv';
import { readJson } from '@/utils/stored';

export const PREF_OPTIONS = {
  remoteContent: ['ask', 'never'],
} as const;

export type Prefs = {
  remoteContent: (typeof PREF_OPTIONS.remoteContent)[number];
  // Lowercased addresses whose remote images load without asking.
  remoteSenders: string[];
  conversations: boolean;
  inboxCategories: boolean;
  relayUrl: string;
  relayToken: string;
  // Hue index per account email, synced so every device shows an account in the same colour.
  accountColors: Record<string, number>;
};

export const prefsSchema = v.looseObject({
  // A value added by a newer app reads as the default here rather than failing the whole document.
  remoteContent: v.fallback(v.picklist(PREF_OPTIONS.remoteContent), 'ask'),
  conversations: v.optional(v.boolean(), true),
  inboxCategories: v.optional(v.boolean(), true),
  relayUrl: v.optional(v.string(), ''),
  relayToken: v.optional(v.string(), ''),
  accountColors: v.optional(v.record(v.string(), v.number()), {}),
  remoteSenders: v.optional(v.array(v.string()), []),
});

const PREF_DEFAULTS: Prefs = v.parse(prefsSchema, {});

const KEY = 'prefs';
const UPDATED_KEY = 'prefs.updatedAt';

const prefsStore = createStore<Prefs>(() => readJson(KEY, prefsSchema, PREF_DEFAULTS));

prefsStore.subscribe((state) => writeItem(KEY, JSON.stringify(state)));

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  writeItem(UPDATED_KEY, String(Date.now()));
  prefsStore.setState({ [key]: value } as Pick<Prefs, K>);
}

export const getSyncedPrefs = () => ({ updatedAt: Number(readItem(UPDATED_KEY) ?? 0), value: prefsStore.getState() });

// A device that never needed a relay (every native one) syncs an empty one, which says nothing about the
// relay a browser on the same vault depends on: this device's stays.
export function restorePrefs(prefs: Prefs, updatedAt: number) {
  writeItem(UPDATED_KEY, String(updatedAt));
  const { relayUrl, relayToken } = prefsStore.getState();
  prefsStore.setState({ ...PREF_DEFAULTS, ...prefs, ...(prefs.relayUrl ? {} : { relayUrl, relayToken }) });
}

export const subscribePrefs = (listener: () => void) => prefsStore.subscribe(listener);

export const getPrefs = () => prefsStore.getState();

export const usePref = <K extends keyof Prefs>(key: K): Prefs[K] => useStore(prefsStore, (state) => state[key]);
