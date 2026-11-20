import * as v from 'valibot';

import type { SyncedAccount } from '@/accounts/store';
import { t } from '@/i18n';
import { prefsSchema, type Prefs } from '@/prefs/store';

// Bumped when a change to the document would be misread by an older app, which then refuses it.
const VERSION = 1;

// Loose objects keep fields this app doesn't know, so syncing never strips what a newer device added.
const server = v.looseObject({ host: v.string(), port: v.number(), security: v.picklist(['tls', 'startTls', 'plain']) });
const address = v.looseObject({ name: v.optional(v.string()), email: v.string() });

const account = v.looseObject({
  email: v.string(),
  displayName: v.string(),
  imap: server,
  smtp: server,
  credentials: v.looseObject({ username: v.string(), password: v.string() }),
  caldavUrl: v.optional(v.string()),
  carddavUrl: v.optional(v.string()),
  identities: v.optional(v.array(address)),
  signature: v.optional(v.string()),
});

const schema = v.looseObject({
  accounts: v.record(v.string(), v.looseObject({ updatedAt: v.number(), account: v.nullable(account) })),
  prefs: v.looseObject({ updatedAt: v.number(), value: prefsSchema }),
});

// A removed account stays as an entry with no account, so the removal outlives older copies on other devices.
type AccountEntry = { updatedAt: number; account: SyncedAccount | null };

export type VaultDocument = {
  accounts: Record<string, AccountEntry>;
  prefs: { updatedAt: number; value: Prefs };
};

// Newest change wins, per account and for the prefs as a whole; a tie keeps the remote copy.
export function mergeDocuments(local: VaultDocument, remote: VaultDocument) {
  const accounts = { ...remote.accounts };
  let changed = false;
  for (const [email, entry] of Object.entries(local.accounts)) {
    if (accounts[email] && accounts[email].updatedAt >= entry.updatedAt) continue;
    accounts[email] = entry;
    changed = true;
  }
  const localPrefs = local.prefs.updatedAt > remote.prefs.updatedAt;
  return {
    document: { ...remote, accounts, prefs: localPrefs ? local.prefs : remote.prefs },
    changed: changed || localPrefs,
  };
}

export const encodeDocument = (document: VaultDocument) =>
  new TextEncoder().encode(JSON.stringify({ version: VERSION, ...document }));

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function decodeDocument(bytes: Uint8Array): VaultDocument {
  const json = parseJson(bytes);
  if (v.is(v.looseObject({ version: v.number() }), json) && json.version > VERSION) {
    throw new Error(t('settings.devices.errors.newerVersion'));
  }
  const result = v.safeParse(schema, json);
  if (!result.success) throw new Error(t('settings.devices.errors.unreadable'));
  const { version: _version, ...document } = result.output;
  return document;
}
