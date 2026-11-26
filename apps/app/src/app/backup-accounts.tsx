import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { sealBackup } from '@/accounts/backup';
import { shareableAccounts } from '@/accounts/share';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { handlesError } from '@/utils/query-client';
import { shareFile } from '@/utils/share-file';
import { MIN_PASSPHRASE } from '@/vault/form';

export default function BackupAccountsScreen() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const save = useMutation({
    meta: handlesError,
    mutationFn: async () => {
      const file = await sealBackup(await shareableAccounts(), password);
      const date = new Date().toISOString().slice(0, 10);
      await shareFile(`mailbowox-backup-${date}.json`, 'application/json', new TextEncoder().encode(file).buffer);
    },
    onSuccess: () => router.back(),
  });

  const tooShort = password.length > 0 && password.length < MIN_PASSPHRASE;
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const ready = password.length >= MIN_PASSPHRASE && confirmation === password;

  return (
    <FormScreen>
      <View style={styles.intro}>
        <ThemedText type="display">{t('settings.devices.backup.headline')}</ThemedText>
        <ThemedText>{t('settings.devices.backup.intro')}</ThemedText>
      </View>

      <View style={styles.field}>
        <TextField
          value={password}
          onChangeText={setPassword}
          placeholder={t('settings.devices.backup.password')}
          accessibilityLabel={t('settings.devices.backup.password')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry
        />
        <TextField
          value={confirmation}
          onChangeText={setConfirmation}
          onSubmitEditing={() => ready && save.mutate()}
          placeholder={t('settings.devices.setup.confirm')}
          accessibilityLabel={t('settings.devices.setup.confirm')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry
          returnKeyType="go"
        />
        {tooShort && (
          <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
            {t('settings.devices.setup.tooShort', { count: MIN_PASSPHRASE })}
          </ThemedText>
        )}
        {mismatch && (
          <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
            {t('settings.devices.setup.mismatch')}
          </ThemedText>
        )}
        <ThemedText type="meta">{t('settings.devices.backup.passwordHint')}</ThemedText>
      </View>

      {save.isError && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
          {save.error.message}
        </ThemedText>
      )}

      <View style={styles.field}>
        <Button
          label={t('settings.devices.backup.save')}
          onPress={() => save.mutate()}
          disabled={!ready}
          loading={save.isPending}
        />
        {save.isPending && (
          <ThemedText type="meta" accessibilityLiveRegion="polite">
            {t('settings.devices.deriving')}
          </ThemedText>
        )}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
});
