import { useMutation } from '@tanstack/react-query';

import { accountConfig, getAccount, setCarddav, type Account } from '@/accounts/store';
import { core, type Contact, type ContactDraft } from '@/core';
import { t } from '@/i18n';
import { handlesError, invalidateContacts } from '@/utils/query-client';
import { settleAll } from '@/utils/settle';

import { mailStore } from '@/mail/store';

import { syncContactsOf } from './sync';

type SaveContact = { account: string; book: string; draft: ContactDraft; contact?: Contact };

export function useSaveContact() {
  return useMutation({
    meta: handlesError,
    mutationFn: async ({ account, book, draft, contact }: SaveContact) => {
      const config = await accountConfig(getAccount(account));
      const saved = contact
        ? await core.updateContact(config, contact, draft)
        : await core.createContact(config, book, draft);
      await (await mailStore()).putContact(account, book, saved);
    },
    onSuccess: invalidateContacts,
  });
}

type DeleteContact = { account: string; contact: Contact };

// Screens showing the contact close themselves once it is gone, so deleting needs no callback.
export function useDeleteContact() {
  return useMutation({
    mutationFn: async ({ account, contact }: DeleteContact) => {
      const config = await accountConfig(getAccount(account));
      await core.deleteContact(config, contact.href, contact.etag);
      await (await mailStore()).removeContact(account, contact.href);
    },
    onSuccess: invalidateContacts,
  });
}

async function findContacts(account: Account) {
  const home = await core.discoverContacts(await accountConfig(account));
  if (!home) throw new Error(t('contacts.find.notFound', { email: account.email }));
  setCarddav(account.id, home);
  await syncContactsOf(account.id);
}

// For accounts added before contacts were supported.
export function useFindContacts(accounts: Account[]) {
  return useMutation({
    mutationFn: () => settleAll(accounts.map(findContacts)),
  });
}
