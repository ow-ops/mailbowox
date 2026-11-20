import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import * as v from 'valibot';

import { getAccounts } from '@/accounts/store';

// The gateway names the account by this hash, never by its address.
const accountHash = (email: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, email.trim().toLowerCase());

export async function accountByHash(hash: unknown) {
  if (typeof hash !== 'string') return undefined;
  for (const account of getAccounts()) {
    if ((await accountHash(account.email)) === hash) return account;
  }
}

// What the gateway pushes: `{ account, unread }`. expo-notifications hands it over as `dataString` on both platforms.
const ping = v.object({ dataString: v.pipe(v.string(), v.parseJson(), v.object({ account: v.string() })) });

export function pingAccount(data: unknown): string | null {
  const result = v.safeParse(ping, data);
  return result.success ? result.output.dataString.account : null;
}
