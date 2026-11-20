import { router } from 'expo-router';
import { Platform } from 'react-native';

import { getAccount } from '@/accounts/store';
import type { MessageSummary } from '@/core';
import { t } from '@/i18n';
import { readItem, removeItem, writeItem } from '@/utils/kv';

import { addressName } from './address';
import { INBOX, setMailView } from './view';

const key = (account: string) => `notify.${account}`;

export const notifiesNewMail = (account: string) => readItem(key(account)) === '1';

// Kept per browser: the permission is the browser's, not the account's.
export async function setNotifyNewMail(account: string, on: boolean) {
  if (!on) {
    removeItem(key(account));
    return;
  }
  if ((await Notification.requestPermission()) !== 'granted') throw new Error(t('settings.notifications.browserDenied'));
  writeItem(key(account), '1');
}

// The browser's own notifications, while a tab is open. Phones are told by push. Nothing shows while the
// tab has focus: the list already has the new mail.
export function announceNewMail(account: string, messages: MessageSummary[]) {
  if (Platform.OS !== 'web' || messages.length === 0 || !notifiesNewMail(account)) return;
  if (Notification.permission !== 'granted' || document.hasFocus()) return;
  const sender = messages[0].from[0];
  const notification =
    messages.length === 1
      ? new Notification(sender ? addressName(sender) : t('settings.notifications.newMail'), {
          body: messages[0].subject,
          tag: account,
        })
      : new Notification(t('settings.notifications.newMails', { count: messages.length }), {
          body: getAccount(account).email,
          tag: account,
        });
  notification.onclick = () => {
    window.focus();
    setMailView({ kind: 'mailbox', account, mailbox: INBOX });
    router.navigate('/mail');
    notification.close();
  };
}
