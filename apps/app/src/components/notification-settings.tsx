import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import type { Account } from '@/accounts/store';
import { Section, ToggleRow } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { notifiesNewMail, setNotifyNewMail } from '@/mail/new-mail';
import { GATEWAY_URL } from '@/push/config';
import { setCheckInBackground } from '@/push/poll';
import { disablePush, enablePush, isPushOn } from '@/push/register';
import { invoke } from '@/utils/desktop';

export function NotificationSettings({ account }: { account: Account }) {
  const { t } = useTranslation();
  if (Platform.OS === 'web') {
    if (!invoke && !('Notification' in window)) return null;
    return (
      <Section title={t('settings.notifications.title')}>
        <Toggle on={notifiesNewMail(account.id)} change={(next) => setNotifyNewMail(account.id, next)} />
        <ThemedText type="meta">{t(invoke ? 'settings.notifications.desktop' : 'settings.notifications.browser')}</ThemedText>
      </Section>
    );
  }
  return (
    <Section title={t('settings.notifications.title')}>
      {!!GATEWAY_URL && (
        <>
          <Toggle on={isPushOn(account.id)} change={(next) => (next ? enablePush(account) : disablePush(account))} />
          <ThemedText type="meta">{t('settings.notifications.explanation')}</ThemedText>
        </>
      )}
      <Toggle
        title={t('settings.notifications.poll')}
        on={notifiesNewMail(account.id)}
        change={(next) => setCheckInBackground(account.id, next)}
      />
      <ThemedText type="meta">{t('settings.notifications.pollExplanation')}</ThemedText>
    </Section>
  );
}

// The toggle shows the requested state while the change is made, so it does not snap back mid-request.
function Toggle({ title, on: initial, change }: { title?: string; on: boolean; change: (next: boolean) => Promise<void> }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(initial);
  const toggle = useMutation({ mutationFn: change, onSuccess: (_, next) => setOn(next) });
  return (
    <ToggleRow
      title={title ?? t('settings.notifications.toggle')}
      value={toggle.isPending ? toggle.variables : on}
      disabled={toggle.isPending}
      onValueChange={toggle.mutate}
    />
  );
}
