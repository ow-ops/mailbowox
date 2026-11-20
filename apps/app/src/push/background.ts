import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { syncMailbox } from '@/mail/sync';
import { INBOX } from '@/mail/view';

import { ANDROID_CHANNEL } from './config';
import { accountByHash, pingAccount } from './payload';

// iOS shows the gateway's fixed alert itself and wakes the app here to sync. Android gets a data-only
// message, so the notification is shown from here, in the user's language.
const PUSH_TASK = 'mailbowox-push';

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error || 'actionIdentifier' in data) return;
  const hash = pingAccount(data.data);
  const account = await accountByHash(hash);
  if (!account) return;
  if (Platform.OS === 'android') {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: account.displayName || account.email,
        body: t('settings.notifications.newMail'),
        data: { account: hash },
      },
      trigger: { channelId: ANDROID_CHANNEL },
    });
  }
  await syncMailbox({ account: account.id, mailbox: INBOX }).catch(() => {
    // The inbox syncs again when the app opens.
  });
});

Notifications.registerTaskAsync(PUSH_TASK).catch(() => {
  // Without the task, pushes still show on iOS; the app syncs when opened.
});
