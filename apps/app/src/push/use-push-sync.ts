import { useEffect } from 'react';

import { getAccounts } from '@/accounts/store';
import { useAppActive } from '@/hooks/use-app-active';
import { useOnline } from '@/utils/network';

import { GATEWAY_URL } from './config';
import { retryUnregistrations, syncPush } from './register';

export function usePushSync(enabled: boolean) {
  const active = useAppActive();
  const online = useOnline();
  useEffect(() => {
    if (GATEWAY_URL && active && online) void retryUnregistrations();
  }, [active, online]);

  useEffect(() => {
    if (!enabled || !GATEWAY_URL) return;
    for (const account of getAccounts()) {
      syncPush(account).catch(() => {
        // The gateway keeps the last registration; the next start tries again.
      });
    }
  }, [enabled]);
}
