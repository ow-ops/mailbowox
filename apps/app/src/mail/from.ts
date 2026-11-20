import type { Account } from '@/accounts/store';
import type { Address, MessageSummary } from '@/core';
import { readItem, writeItem } from '@/utils/kv';

import { sameAddress } from './address';
import type { MailView } from './view';

const KEY = 'compose.from';

export const getLastFrom = () => readItem(KEY);

export const setLastFrom = (email: string) => writeItem(KEY, email);

export type Sender = { account: string; address: Address };

export const sameSender = (a: Sender, b: Sender) => a.account === b.account && sameAddress(a.address, b.address);

// Each account's own address comes first, then its identities. An identity without a name signs with the account's.
export const senders = (accounts: Account[]): Sender[] =>
  accounts.flatMap((account) =>
    [{ email: account.email }, ...(account.identities ?? [])].map(({ email, name }) => {
      const signed = name || account.displayName;
      return { account: account.id, address: signed ? { name: signed, email } : { email } };
    }),
  );

// A reply goes out from the address the message was written to: a matching To or Cc, else a matching
// Delivered-To (Bcc, lists). Of several, the one in the account it arrived in wins; with no match, that
// account's own address.
export function replySender(accounts: Account[], original: MessageSummary, arrivedIn: string) {
  const all = senders(accounts);
  const matching = (recipients: Address[]) => all.filter((s) => recipients.some((r) => sameAddress(r, s.address)));
  const written = matching([...original.to, ...original.cc]);
  const addressed = written.length > 0 ? written : matching(original.deliveredTo.map((email) => ({ email })));
  return addressed.find((s) => s.account === arrivedIn) ?? addressed[0] ?? all.find((s) => s.account === arrivedIn)!;
}

// A new message goes out from the account being viewed; in views that mix accounts, from the address last
// picked, else the first.
export function newMessageSender(accounts: Account[], view: MailView, lastPicked: string | null) {
  const all = senders(accounts);
  if (view.kind === 'mailbox') return all.find((s) => s.account === view.account)!;
  return all.find((s) => s.address.email === lastPicked) ?? all[0];
}
