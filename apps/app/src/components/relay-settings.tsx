import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Row, Section } from '@/components/settings';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePref } from '@/prefs/store';
import { HOSTED_RELAY_URL, isRelayUrl, relayReachable, relayRefusesCode, saveRelay } from '@/utils/relay';

type Props = { submitLabel: string; variant: 'primary' | 'outline'; onSaved: () => void };

export function RelayForm({ submitLabel, variant, onSaved }: Props) {
  const { t } = useTranslation();
  const savedUrl = usePref('relayUrl');
  const savedToken = usePref('relayToken');
  const [url, setUrl] = useState(savedUrl || HOSTED_RELAY_URL);
  const [token, setToken] = useState(savedToken);

  const save = useMutation({
    mutationFn: async (entered: { url: string; token: string }) => {
      if (!isRelayUrl(entered.url)) return 'invalid';
      if (!(await relayReachable(entered.url))) return 'unreachable';
      if (await relayRefusesCode(entered.url, entered.token)) return 'refused';
      try {
        saveRelay(entered.url, entered.token);
      } catch {
        return 'invalid';
      }
      onSaved();
      return 'saved';
    },
  });
  const problem = save.data === 'saved' ? undefined : save.data;
  const blocker = !url.trim() ? 'needsUrl' : !token.trim() ? 'needsToken' : undefined;

  const edited = (set: (value: string) => void) => (value: string) => {
    set(value);
    save.reset();
  };

  return (
    <>
      <View style={styles.field}>
        <ThemedText type="label">{t('settings.relay.url')}</ThemedText>
        <TextField
          value={url}
          onChangeText={edited(setUrl)}
          placeholder="https://relay.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel={t('settings.relay.url')}
        />
        {problem && (
          <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
            {t(`settings.relay.${problem}`, { url: url.trim() })}
          </ThemedText>
        )}
      </View>
      <View style={styles.field}>
        <ThemedText type="label">{t('settings.relay.token')}</ThemedText>
        <TextField
          value={token}
          onChangeText={edited(setToken)}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          accessibilityLabel={t('settings.relay.token')}
        />
        <ThemedText type="meta">{t('settings.relay.tokenHint')}</ThemedText>
      </View>
      <View style={styles.field}>
        <Button
          label={submitLabel}
          variant={variant}
          onPress={() => save.mutate({ url: url.trim(), token: token.trim() })}
          disabled={!!blocker}
          loading={save.isPending}
        />
        {blocker && (
          <ThemedText type="meta" style={styles.blocker} accessibilityLiveRegion="polite">
            {t(`settings.relay.${blocker}`)}
          </ThemedText>
        )}
      </View>
    </>
  );
}

export function RelaySettings() {
  const { t } = useTranslation();
  const relayUrl = usePref('relayUrl');
  return (
    <Section
      title={t('settings.relay.title')}
      footer={
        <View style={styles.field}>
          {!relayUrl && (
            <ThemedText type="meta" themeColor="danger">
              {t('settings.relay.missing')}
            </ThemedText>
          )}
          <ThemedText type="meta">{t('settings.relay.hint')}</ThemedText>
        </View>
      }>
      <Row
        title={t('settings.relay.url')}
        value={relayUrl ? relayUrl.replace(/^https?:\/\//, '') : t('settings.relay.notSet')}
        chevron
        onPress={() => router.push('/relay')}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  blocker: {
    textAlign: 'center',
  },
});
