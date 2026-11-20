import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';

import { INBOX, setMailView } from '@/mail/view';

import { accountByHash } from './payload';

export function usePushTaps(enabled: boolean) {
  // iOS keeps the gateway's `{ account, unread }` as the data; Android's local notification carries `{ account }`.
  const open = useEffectEvent(async (response: Notifications.NotificationResponse) => {
    Notifications.clearLastNotificationResponse();
    const account = await accountByHash(response.notification.request.content.data?.account);
    if (account) setMailView({ kind: 'mailbox', account: account.id, mailbox: INBOX });
    router.navigate('/mail');
  });

  useEffect(() => {
    if (!enabled) return;
    // A tap that launched the app arrives before the listener exists.
    const launch = Notifications.getLastNotificationResponse();
    if (launch) open(launch);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => open(response));
    return () => subscription.remove();
  }, [enabled]);
}
