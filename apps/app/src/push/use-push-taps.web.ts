import { router } from 'expo-router';
import { useEffect } from 'react';

import { accountExists } from '@/accounts/store';
import { INBOX, setMailView } from '@/mail/view';
import { listen } from '@/utils/desktop';

// A click on a desktop shell notification: the shell shows the window and names the account.
export function usePushTaps(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !listen) return;
    const listening = listen<string>('open-inbox', ({ payload: account }) => {
      if (accountExists(account)) setMailView({ kind: 'mailbox', account, mailbox: INBOX });
      router.navigate('/mail');
    });
    return () => void listening.then((stop) => stop());
  }, [enabled]);
}
