import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { LinkCode } from '@/components/link-code';
import { LinkQr } from '@/components/link-qr';
import { LinkScanner } from '@/components/link-scanner';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { handlesError } from '@/utils/query-client';
import { type LinkOffer, type LinkSession } from '@/vault/crypto';
import { loadVaultKey } from '@/vault/key';
import { answerOffer, sendVaultKey, startOffer, waitForJoiner, type Offer } from '@/vault/link';
import { normalizeGateway, useVault } from '@/vault/sync';

type Method = 'show' | 'scan';

type Pending = { offer: LinkOffer; session: LinkSession };

export default function LinkDeviceScreen() {
  const { gateway } = useVault();
  return gateway ? <LinkDevice gateway={gateway} /> : null;
}

function LinkDevice({ gateway }: { gateway: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [method, setMethod] = useState<Method>('show');
  const [offer, setOffer] = useState<Offer>(() => startOffer(gateway));
  const [scanned, setScanned] = useState<LinkOffer | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (method !== 'show' || pending || error) return;
    const controller = new AbortController();
    waitForJoiner(offer, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        // Nobody scanned the code in time: show a fresh one, so an old photo of it is useless.
        if (answer) setPending({ offer: offer.offer, session: answer });
        else setOffer(startOffer(gateway));
      },
      (cause: Error) => !controller.signal.aborted && setError(cause.message),
    );
    return () => controller.abort();
  }, [method, offer, pending, error, gateway]);

  useEffect(() => {
    if (!scanned) return;
    let cancelled = false;
    answerOffer(scanned).then(
      (session) => !cancelled && setPending({ offer: scanned, session }),
      (cause: Error) => !cancelled && setError(cause.message),
    );
    return () => {
      cancelled = true;
    };
  }, [scanned]);

  const scan = (offer: LinkOffer) => {
    // The new device waits for the vault key on the gateway it named: it has to be the one this vault lives on.
    if (normalizeGateway(offer.gateway) === gateway) setScanned(offer);
    else setError(t('settings.devices.errors.otherGateway', { gateway: offer.gateway }));
  };

  const send = useMutation({
    meta: handlesError,
    mutationFn: async ({ offer, session }: Pending) => {
      const key = await loadVaultKey();
      if (!key) throw new Error(t('settings.devices.errors.off'));
      await sendVaultKey(offer, session, key);
    },
  });

  const restart = () => {
    send.reset();
    setError(null);
    setScanned(null);
    setPending(null);
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

  if (pending) {
    return (
      <FormScreen>
        <View style={styles.intro}>
          <ThemedText type="display">{t('settings.devices.link.compareHeadline')}</ThemedText>
          <ThemedText>{t('settings.devices.link.compare')}</ThemedText>
        </View>
        <LinkCode code={pending.session.code} />
        <View style={styles.actions}>
          <Button label={t('settings.devices.link.match')} onPress={() => send.mutate(pending)} loading={send.isPending} />
          <Button label={t('settings.devices.link.noMatch')} variant="outline" onPress={restart} />
        </View>
      </FormScreen>
    );
  }

  return (
    <FormScreen>
      <View style={styles.intro}>
        <ThemedText type="display">
          {method === 'show' ? t('settings.devices.link.headline') : t('settings.devices.link.scanHeadline')}
        </ThemedText>
        <ThemedText>{method === 'show' ? t('settings.devices.link.intro') : t('settings.devices.link.scanIntro')}</ThemedText>
      </View>
      <SegmentedControl
        label={t('settings.devices.link.method')}
        options={(['show', 'scan'] as const).map((value) => ({
          value,
          label: t(`settings.devices.link.methods.${value}`),
        }))}
        value={method}
        onChange={setMethod}
      />
      {method === 'show' ? (
        <>
          <LinkQr offer={offer.offer} label={t('settings.devices.link.qrLabel')} />
          <View style={styles.waiting} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.muted} />
            <ThemedText type="meta">{t('settings.devices.link.waiting')}</ThemedText>
          </View>
        </>
      ) : scanned ? (
        <View style={styles.waiting} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.muted} />
          <ThemedText type="meta">{t('settings.devices.join.connecting')}</ThemedText>
        </View>
      ) : (
        <LinkScanner hint={t('settings.devices.link.scanHint')} onOffer={scan} />
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: Spacing.three,
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
