import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import type { Account } from '@/accounts/store';
import { Section, ToggleRow } from '@/components/settings';
import { notifiesNewMail, setNotifyNewMail } from '@/mail/new-mail';
import { GATEWAY_URL } from '@/push/config';
import { setCheckInBackground } from '@/push/poll';
import { disablePush, enablePush, isPushOn } from '@/push/register';
import { invoke } from '@/utils/desktop';

// Section lines up only its own rows, so each switch is a ToggleRow here rather than a component around one.
function useSwitch(initial: boolean, change: (next: boolean) => Promise<void>) {
  const [on, setOn] = useState(initial);
  const toggle = useMutation({ mutationFn: change, onSuccess: (_, next) => setOn(next) });
  return { value: toggle.isPending ? toggle.variables : on, disabled: toggle.isPending, onValueChange: toggle.mutate };
}

export function NotificationSettings({ account }: { account: Account }) {
  const { t } = useTranslation();
  const notify = useSwitch(notifiesNewMail(account.id), (next) => setNotifyNewMail(account.id, next));
  const push = useSwitch(isPushOn(account.id), (next) => (next ? enablePush(account) : disablePush(account)));
  const poll = useSwitch(notifiesNewMail(account.id), (next) => setCheckInBackground(account.id, next));
  if (Platform.OS === 'web') {
    if (!invoke && !('Notification' in window)) return null;
    return (
      <Section
        title={t('settings.notifications.title')}
        footer={t(invoke ? 'settings.notifications.desktop' : 'settings.notifications.browser')}>
        <ToggleRow title={t('settings.notifications.toggle')} {...notify} />
      </Section>
    );
  }
  return (
    <Section title={t('settings.notifications.title')}>
      {!!GATEWAY_URL && (
        <ToggleRow title={t('settings.notifications.toggle')} detail={t('settings.notifications.explanation')} {...push} />
      )}
      <ToggleRow title={t('settings.notifications.poll')} detail={t('settings.notifications.pollExplanation')} {...poll} />
    </Section>
  );
}
