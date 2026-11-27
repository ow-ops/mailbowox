import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { accountLabel } from '@/accounts/colors';
import { useAccounts } from '@/accounts/store';
import { SettingsScreen } from '@/components/settings';
import { ThemeSlot } from '@/components/theme-slot';
import { ThemedText } from '@/components/themed-text';

export default function AccountThemeScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAccounts().find((a) => a.id === id);
  if (!account) return null;
  const key = account.email.toLowerCase();

  return (
    <SettingsScreen title={t('settings.accountTheme.title', { label: accountLabel(account) })}>
      <ThemedText type="meta">{t('settings.accountTheme.hint')}</ThemedText>
      <ThemeSlot kind="light" account={key} />
      <ThemeSlot kind="dark" account={key} />
    </SettingsScreen>
  );
}
