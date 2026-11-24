import { useEffect } from 'react';

import { subscribeAccounts } from '@/accounts/store';
import { watchDesktopInboxes } from '@/mail/new-mail';

// Web has no push. The desktop shell watches the inboxes itself, so it is handed them at start and whenever the
// accounts change.
export function usePushSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void watchDesktopInboxes();
    return subscribeAccounts(() => void watchDesktopInboxes());
  }, [enabled]);
}
