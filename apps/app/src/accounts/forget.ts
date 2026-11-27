import { removeAccountDrafts } from '@/mail/local-drafts';
import { setNotifyNewMail } from '@/mail/new-mail';
import { invalidateContacts, invalidateMail } from '@/utils/query-client';
import { closeSession } from '@/mail/session';
import { mailStore } from '@/mail/store';
import { dropPush } from '@/push/register';
import { clearAccountTheme } from '@/theme/store';

import { accountExists, accountsReadable, removeAccount, type Account } from './store';

// The account leaves the list before its data is deleted: that stops its watchers, and a sync already
// under way sees it gone and writes nothing more.
export async function forgetAccount(account: Account) {
  await dropPush(account);
  await setNotifyNewMail(account.id, false);
  await removeAccount(account.id);
  await closeSession(account.id);
  await (await mailStore()).deleteAccount(account.id);
  await removeAccountDrafts(account.id);
  clearAccountTheme(account.email.toLowerCase());
  invalidateMail();
  invalidateContacts();
}

// Deletes what removed accounts left behind: a removal the app was closed during, or a write that landed
// after it. Nothing is touched when the account list couldn't be read, as every account would look removed.
export async function sweepRemovedAccounts() {
  if (!accountsReadable()) return;
  const store = await mailStore();
  for (const id of await store.storedAccounts()) if (!accountExists(id)) await store.deleteAccount(id);
}
