import { useEffect } from 'react';

import { useAccounts } from '@/accounts/store';
import { ownAddresses } from '@/mail/filters';
import { useFlushOutbox } from '@/mail/outbox';
import { mailStore } from '@/mail/store';
import { useWatchMailbox } from '@/mail/sync';
import { INBOX, useMailView } from '@/mail/view';

// Every account watches its inbox, each on its own connection, and the open mailbox gets a watcher of its own.
export function MailSync() {
  const accounts = useAccounts();
  const view = useMailView();
  useFlushOutbox();
  // The store learns who each account writes to from its sent mail, which it tells apart by these.
  useEffect(() => {
    void mailStore().then((store) =>
      Promise.all(accounts.map((account) => store.setOwnAddresses(account.id, ownAddresses(account)))),
    );
  }, [accounts]);
  return (
    <>
      {accounts.map((account) => (
        <Watcher key={account.id} account={account.id} mailbox={INBOX} />
      ))}
      {view.kind === 'mailbox' && view.mailbox !== INBOX && (
        <Watcher key={`${view.account}/${view.mailbox}`} account={view.account} mailbox={view.mailbox} />
      )}
    </>
  );
}

function Watcher({ account, mailbox }: { account: string; mailbox: string }) {
  useWatchMailbox(account, mailbox);
  return null;
}
