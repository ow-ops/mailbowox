import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getAccounts } from '@/accounts/store';
import { t } from '@/i18n';
import { addressName } from '@/mail/address';
import { markNotifyNewMail, notifiesNewMail } from '@/mail/new-mail';
import { withSession } from '@/mail/session';
import { mailStore } from '@/mail/store';
import { PAGE_SIZE } from '@/mail/sync';
import { INBOX } from '@/mail/view';

import { ANDROID_CHANNEL } from './config';
import { isPushOn } from './register';

// Without push, the system wakes the app now and then (every 15 minutes at best on Android, less often on
// iOS) to sync each inbox and tell of new mail itself. Nothing leaves the device but the IMAP connection.
const POLL_TASK = 'mailbowox-poll';

const polled = () => getAccounts().filter(({ id }) => notifiesNewMail(id) && !isPushOn(id));

TaskManager.defineTask(POLL_TASK, async () => {
  const store = await mailStore();
  for (const account of polled()) {
    const outcome = await withSession(account.id, (s) => store.syncMailbox(s, account.id, INBOX, PAGE_SIZE)).catch(
      () => null,
    );
    for (const message of outcome?.arrived ?? []) {
      const sender = message.from[0];
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sender ? addressName(sender) : account.displayName || account.email,
          body: message.subject || t('settings.notifications.newMail'),
          data: { account: account.id },
        },
        trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : null,
      });
    }
  }
  return BackgroundTask.BackgroundTaskResult.Success;
});

async function schedule() {
  if (polled().length) await BackgroundTask.registerTaskAsync(POLL_TASK, { minimumInterval: 15 });
  else if (await TaskManager.isTaskRegisteredAsync(POLL_TASK)) await BackgroundTask.unregisterTaskAsync(POLL_TASK);
}

export async function setCheckInBackground(account: string, on: boolean) {
  if (on && !(await Notifications.requestPermissionsAsync()).granted) {
    throw new Error(t('settings.notifications.denied'));
  }
  markNotifyNewMail(account, on);
  await schedule();
}
