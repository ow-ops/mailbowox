import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Row, Section, SettingsScreen } from '@/components/settings';
import { setPref, usePref } from '@/prefs/store';

export default function RemoteSendersScreen() {
  const { t } = useTranslation();
  const senders = usePref('remoteSenders');

  const remove = (email: string) => {
    const rest = senders.filter((other) => other !== email);
    setPref('remoteSenders', rest);
    if (rest.length === 0) router.back();
  };

  return (
    <SettingsScreen title={t('settings.privacy.remoteSenders')}>
      <Section footer={t('settings.privacy.remoteSendersHint')}>
        {senders.map((email) => (
          <Row key={email} title={email} detail={t('settings.privacy.stopLoading')} onPress={() => remove(email)} />
        ))}
      </Section>
    </SettingsScreen>
  );
}
