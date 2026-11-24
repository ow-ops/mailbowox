import { deleteAccountData as deleteContactData, storedAccounts as contactAccounts } from '@/contacts/db';
import { removeAccountDrafts } from '@/mail/local-drafts';
import { setNotifyNewMail } from '@/mail/new-mail';
import { invalidateContacts, invalidateMail } from '@/utils/query-client';
import { closeSession } from '@/mail/session';
import { mailStore } from '@/mail/store';
import { dropPush } from '@/push/register';

import { accountExists, accountsReadable, removeAccount, type Account } from './store';

const stores = [
  [async () => (await mailStore()).storedAccounts(), async (id: string) => (await mailStore()).deleteAccount(id)],
  [contactAccounts, deleteContactData],
] as const;

// The account leaves the list before its data is deleted: that stops its watchers, and a sync already
// under way sees it gone and writes nothing more.
export async function forgetAccount(account: Account) {
  await dropPush(account);
  await setNotifyNewMail(account.id, false);
  await removeAccount(account.id);
  await closeSession(account.id);
  for (const [, remove] of stores) await remove(account.id);
  await removeAccountDrafts(account.id);
  invalidateMail();
  invalidateContacts();
}

// Deletes what removed accounts left behind: a removal the app was closed during, or a write that landed
// after it. Nothing is touched when the account list couldn't be read, as every account would look removed.
export async function sweepRemovedAccounts() {
  if (!accountsReadable()) return;
  for (const [stored, remove] of stores) {
    for (const id of await stored()) if (!accountExists(id)) await remove(id);
  }
}
