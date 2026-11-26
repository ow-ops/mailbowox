import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { shareableAccounts, shareCodes } from '@/accounts/share';
import type { SyncedAccount } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { LinkQr } from '@/components/link-qr';
import { ToggleRow } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function ShareAccountsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [accounts, setAccounts] = useState<SyncedAccount[] | null>(null);
  const [passwords, setPasswords] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    shareableAccounts().then(setAccounts);
  }, []);

  const codes = useMemo(
    () =>
      accounts &&
      shareCodes(
        passwords ? accounts : accounts.map((a) => ({ ...a, credentials: { ...a.credentials, password: '' } })),
      ),
    [accounts, passwords],
  );

  const includePasswords = (value: boolean) => {
    setPasswords(value);
    setIndex(0);
  };

  if (!codes) {
    return (
      <FormScreen>
        <ActivityIndicator color={theme.muted} />
      </FormScreen>
    );
  }

  return (
    <FormScreen>
      <View style={styles.intro}>
        <ThemedText type="display">{t('settings.devices.share.headline')}</ThemedText>
        <ThemedText>{t('settings.devices.share.intro')}</ThemedText>
      </View>
      <ToggleRow
        title={t('settings.devices.share.passwords')}
        detail={passwords ? undefined : t('settings.devices.share.noPasswords')}
        value={passwords}
        onValueChange={includePasswords}
      />
      <LinkQr value={codes[index]} label={t('settings.devices.share.qrLabel')} />
      {codes.length > 1 && (
        <ThemedText type="meta" style={styles.count} accessibilityLiveRegion="polite">
          {t('settings.devices.share.count', { index: index + 1, total: codes.length })}
        </ThemedText>
      )}
      {passwords && (
        <ThemedText type="meta" themeColor="danger">
          {t('settings.devices.share.warning')}
        </ThemedText>
      )}
      <View style={styles.actions}>
        {index < codes.length - 1 ? (
          <Button label={t('settings.devices.share.next')} onPress={() => setIndex(index + 1)} />
        ) : (
          <Button label={t('settings.devices.link.close')} onPress={() => router.back()} />
        )}
        {index > 0 && (
          <Button label={t('settings.devices.share.previous')} variant="outline" onPress={() => setIndex(index - 1)} />
        )}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: Spacing.three,
  },
  count: {
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.three,
  },
});
