import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RelayForm } from '@/components/relay-settings';
import { SettingsScreen } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { showToast } from '@/utils/toast';

export default function RelayScreen() {
  const { t } = useTranslation();
  const saved = () => {
    showToast(t('settings.relay.saved'));
    router.back();
  };
  return (
    <SettingsScreen title={t('settings.relay.title')}>
      <ThemedText type="meta">{t('settings.relay.hint')}</ThemedText>
      <RelayForm submitLabel={t('settings.relay.save')} variant="primary" onSaved={saved} />
    </SettingsScreen>
  );
}
