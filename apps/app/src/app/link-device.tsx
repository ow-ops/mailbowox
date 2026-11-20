import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { LinkCode } from '@/components/link-code';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { handlesError } from '@/utils/query-client';
import { encodeOffer, type LinkSession } from '@/vault/crypto';
import { loadVaultKey } from '@/vault/key';
import { sendVaultKey, startOffer, waitForJoiner, type Offer } from '@/vault/link';
import { useVault } from '@/vault/sync';

const QR_SIZE = 240;

export default function LinkDeviceScreen() {
  const { gateway } = useVault();
  return gateway ? <LinkDevice gateway={gateway} /> : null;
}

function LinkDevice({ gateway }: { gateway: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [offer, setOffer] = useState<Offer>(() => startOffer(gateway));
  const [session, setSession] = useState<LinkSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session || error) return;
    const controller = new AbortController();
    waitForJoiner(offer, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        // Nobody scanned the code in time: show a fresh one, so an old photo of it is useless.
        if (answer) setSession(answer);
        else setOffer(startOffer(gateway));
      },
      (cause: Error) => !controller.signal.aborted && setError(cause.message),
    );
    return () => controller.abort();
  }, [offer, session, error, gateway]);

  const send = useMutation({
    meta: handlesError,
    mutationFn: async (accepted: LinkSession) => {
      const key = await loadVaultKey();
      if (!key) throw new Error(t('settings.devices.errors.off'));
      await sendVaultKey(offer.offer, accepted, key);
    },
  });

  const restart = () => {
    send.reset();
    setError(null);
    setSession(null);
    setOffer(startOffer(gateway));
  };

  if (error || send.isError) {
    return (
      <FormScreen>
        <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
          {error ?? send.error?.message}
        </ThemedText>
        <Button label={t('common.retry')} onPress={restart} />
      </FormScreen>
    );
  }

  if (send.isSuccess) {
    return (
      <FormScreen>
        <View style={styles.intro}>
          <ThemedText type="display">{t('settings.devices.link.doneHeadline')}</ThemedText>
          <ThemedText>{t('settings.devices.link.done')}</ThemedText>
        </View>
        <Button label={t('settings.devices.link.close')} onPress={() => router.back()} />
      </FormScreen>
    );
  }

  if (session) {
    return (
      <FormScreen>
        <View style={styles.intro}>
          <ThemedText type="display">{t('settings.devices.link.compareHeadline')}</ThemedText>
          <ThemedText>{t('settings.devices.link.compare')}</ThemedText>
        </View>
        <LinkCode code={session.code} />
        <View style={styles.actions}>
          <Button label={t('settings.devices.link.match')} onPress={() => send.mutate(session)} loading={send.isPending} />
          <Button label={t('settings.devices.link.noMatch')} variant="outline" onPress={restart} />
        </View>
      </FormScreen>
    );
  }

  return (
    <FormScreen>
      <View style={styles.intro}>
        <ThemedText type="display">{t('settings.devices.link.headline')}</ThemedText>
        <ThemedText>{t('settings.devices.link.intro')}</ThemedText>
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('settings.devices.link.qrLabel')}
        style={[styles.code, { backgroundColor: Colors.light.page }]}>
        <QRCode
          value={encodeOffer(offer.offer)}
          size={QR_SIZE}
          color={Colors.light.heading}
          backgroundColor={Colors.light.page}
          ecl="M"
        />
      </View>
      <View style={styles.waiting} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.muted} />
        <ThemedText type="meta">{t('settings.devices.link.waiting')}</ThemedText>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: Spacing.three,
  },
  code: {
    alignSelf: 'center',
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  actions: {
    gap: Spacing.three,
  },
});
