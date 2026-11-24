import { router } from 'expo-router';
import { Platform } from 'react-native';

import { accountConfig, getAccount, getAccounts } from '@/accounts/store';
import type { MessageSummary } from '@/core';
import { t } from '@/i18n';
import { invoke } from '@/utils/desktop';
import { readItem, removeItem, writeItem } from '@/utils/kv';

import { addressName } from './address';
import { INBOX, setMailView } from './view';

const key = (account: string) => `notify.${account}`;

export const notifiesNewMail = (account: string) => readItem(key(account)) === '1';

export const markNotifyNewMail = (account: string, on: boolean) => (on ? writeItem(key(account), '1') : removeItem(key(account)));

// Kept per browser: the permission is the browser's, not the account's. The desktop shell needs none.
export async function setNotifyNewMail(account: string, on: boolean) {
  if (on && !invoke && (await Notification.requestPermission()) !== 'granted') {
    throw new Error(t('settings.notifications.browserDenied'));
  }
  markNotifyNewMail(account, on);
  await watchDesktopInboxes();
}

let handing = Promise.resolve();

// The desktop shell watches these inboxes itself, also from the tray. It gets the whole list, passwords
// included, each time it may have changed; calls run in order, so the last list wins.
export function watchDesktopInboxes() {
  const hand = async () => {
    if (!invoke) return;
    const accounts = [];
    for (const account of getAccounts().filter(({ id }) => notifiesNewMail(id))) {
      const config = await accountConfig(account).catch(() => null);
      if (!config) continue;
      const { username, password } = config.credentials;
      accounts.push({ id: account.id, imap: config.imap, username, password });
    }
    await invoke('watch_inboxes', { accounts });
  };
  handing = handing.then(hand, hand);
  return handing;
}

// The browser's own notifications, while a tab is open. Phones are told by push, and the desktop shell shows
// its own. Nothing shows while the tab has focus: the list already has the new mail.
export function announceNewMail(account: string, messages: MessageSummary[]) {
  if (Platform.OS !== 'web' || invoke || messages.length === 0 || !notifiesNewMail(account)) return;
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
