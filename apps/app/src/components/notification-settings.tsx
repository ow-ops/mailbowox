import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import type { Account } from '@/accounts/store';
import { Section, ToggleRow } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { notifiesNewMail, setNotifyNewMail } from '@/mail/new-mail';
import { GATEWAY_URL } from '@/push/config';
import { disablePush, enablePush, isPushOn } from '@/push/register';

export function NotificationSettings({ account }: { account: Account }) {
  const { t } = useTranslation();
  if (Platform.OS === 'web') {
    if (!('Notification' in window)) return null;
    return (
      <Section title={t('settings.notifications.title')}>
        <Toggle on={notifiesNewMail(account.id)} change={(next) => setNotifyNewMail(account.id, next)} />
        <ThemedText type="meta">{t('settings.notifications.browser')}</ThemedText>
      </Section>
    );
  }
  if (!GATEWAY_URL) return null;
  return (
    <Section title={t('settings.notifications.title')}>
      <Toggle on={isPushOn(account.id)} change={(next) => (next ? enablePush(account) : disablePush(account))} />
      <ThemedText type="meta">{t('settings.notifications.explanation')}</ThemedText>
    </Section>
  );
}

// The toggle shows the requested state while the change is made, so it does not snap back mid-request.
function Toggle({ on: initial, change }: { on: boolean; change: (next: boolean) => Promise<void> }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(initial);
  const toggle = useMutation({ mutationFn: change, onSuccess: (_, next) => setOn(next) });
  return (
    <ToggleRow
      title={t('settings.notifications.toggle')}
      value={toggle.isPending ? toggle.variables : on}
      disabled={toggle.isPending}
      onValueChange={toggle.mutate}
    />
  );
}
