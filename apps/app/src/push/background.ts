import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { syncMailbox } from '@/mail/sync';
import { INBOX } from '@/mail/view';

import { ANDROID_CHANNEL } from './config';
import { getOrCreatePushKeys } from './keys';
import { accountByHash, pingAccount } from './payload';
import { openPreview } from './preview';

// iOS shows the alert itself and wakes the app here to sync. Android gets a data-only message, so the
// notification is shown from here, with the sealed preview when it opens.
const PUSH_TASK = 'mailbowox-push';

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error || 'actionIdentifier' in data) return;
  const hash = pingAccount(data.data);
  const account = await accountByHash(hash);
  if (!account) return;
  if (Platform.OS === 'android') {
    const preview = await getOrCreatePushKeys()
      .then((keys) => openPreview(data.data.m, keys))
      .catch(() => null);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: preview?.title || account.displayName || account.email,
        // Android shows a subtitle as small header text, so the subject leads the body instead.
        body: [preview?.subtitle, preview?.body].filter(Boolean).join('\n') || t('settings.notifications.newMail'),
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
