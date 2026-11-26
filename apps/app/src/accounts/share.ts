import * as v from 'valibot';

import { addAccount, getAccounts, hasAccount, syncedAccount, type SyncedAccount } from '@/accounts/store';
import { accountSchema } from '@/vault/document';

// Keeps each code sparse enough for a laptop webcam to read off a phone screen.
const MAX_CHARS = 800;

const partSchema = v.object({
  mailbowox: v.literal('accounts'),
  set: v.string(),
  part: v.pipe(v.number(), v.integer(), v.minValue(0)),
  parts: v.pipe(v.number(), v.integer(), v.minValue(1)),
  accounts: v.array(accountSchema),
});

export type SharePart = v.InferOutput<typeof partSchema>;

// An account too big to share a code gets one of its own.
export function shareCodes(accounts: SyncedAccount[]) {
  const set = Math.random().toString(36).slice(2, 10);
  const groups: SyncedAccount[][] = [];
  for (const account of accounts) {
    const last = groups.at(-1);
    if (last && JSON.stringify([...last, account]).length <= MAX_CHARS) last.push(account);
    else groups.push([account]);
  }
  return groups.map((group, part) =>
    JSON.stringify({ mailbowox: 'accounts', set, part, parts: groups.length, accounts: group }),
  );
}

// Null for any QR code that is not part of a share.
export function decodeSharePart(data: string): SharePart | null {
  try {
    const result = v.safeParse(partSchema, JSON.parse(data));
    return result.success && result.output.part < result.output.parts ? result.output : null;
  } catch {
    return null;
  }
}

// An account whose password this device lost can't be shared, and must not keep the others from it.
export async function shareableAccounts() {
  const results = await Promise.allSettled(getAccounts().map(syncedAccount));
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

// Accounts this device already has keep their own settings.
export async function importAccounts(accounts: SyncedAccount[]) {
  for (const account of accounts) {
    if (!hasAccount(account.email)) await addAccount(account);
  }
}
