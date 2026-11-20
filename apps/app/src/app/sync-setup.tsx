import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isEmail } from '@/mail/address';
import { handlesError } from '@/utils/query-client';
import { showToast } from '@/utils/toast';
import { MIN_PASSPHRASE, validGateway } from '@/vault/form';
import { normalizeGateway, unlockWithPassphrase } from '@/vault/sync';

export default function SyncSetupScreen() {
  const { t } = useTranslation();
  const [gateway, setGateway] = useState('');
  const [email, setEmail] = useState(useAccounts()[0]?.email ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const turnOn = useMutation({
    meta: handlesError,
    mutationFn: () => unlockWithPassphrase(normalizeGateway(gateway), email.trim(), passphrase, true),
    onSuccess: () => {
      showToast(t('settings.devices.setup.done'));
      router.back();
    },
  });

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = confirmation.length > 0 && confirmation !== passphrase;
  const ready =
    validGateway(gateway) && isEmail(email.trim()) && passphrase.length >= MIN_PASSPHRASE && confirmation === passphrase;

  return (
    <FormScreen>
      <View style={styles.intro}>
        <ThemedText type="display">{t('settings.devices.setup.headline')}</ThemedText>
        <ThemedText>{t('settings.devices.setup.intro')}</ThemedText>
      </View>

      <View style={styles.field}>
        <TextField
          value={gateway}
          onChangeText={setGateway}
          placeholder={t('settings.devices.gatewayPlaceholder')}
          accessibilityLabel={t('settings.devices.gateway')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
        />
        <ThemedText type="meta">{t('settings.devices.gatewayHint')}</ThemedText>
      </View>

      <View style={styles.field}>
        <TextField
          value={email}
          onChangeText={setEmail}
          placeholder={t('settings.devices.email')}
          accessibilityLabel={t('settings.devices.email')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <ThemedText type="meta">{t('settings.devices.setup.emailHint')}</ThemedText>
      </View>

      <View style={styles.field}>
        <TextField
          value={passphrase}
          onChangeText={setPassphrase}
          placeholder={t('settings.devices.passphrase')}
          accessibilityLabel={t('settings.devices.passphrase')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry
        />
        <TextField
          value={confirmation}
          onChangeText={setConfirmation}
          onSubmitEditing={() => ready && turnOn.mutate()}
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
        <ThemedText type="meta">{t('settings.devices.setup.passphraseHint')}</ThemedText>
      </View>

      {turnOn.isError && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
          {turnOn.error.message}
        </ThemedText>
      )}

      <View style={styles.field}>
        <Button
          label={t('settings.devices.setup.submit')}
          onPress={() => turnOn.mutate()}
          disabled={!ready}
          loading={turnOn.isPending}
        />
        {turnOn.isPending && (
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
