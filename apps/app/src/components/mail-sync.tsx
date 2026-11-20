import { useAccounts } from '@/accounts/store';
import { useFlushOutbox } from '@/mail/outbox';
import { useWatchMailbox } from '@/mail/sync';
import { INBOX, useMailView } from '@/mail/view';

// Every account watches its inbox, each on its own connection, and the open mailbox gets a watcher of its own.
export function MailSync() {
  const accounts = useAccounts();
  const view = useMailView();
  useFlushOutbox();
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
