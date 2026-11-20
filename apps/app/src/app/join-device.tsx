import { useMutation } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getAccounts } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { LinkCode } from '@/components/link-code';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isEmail } from '@/mail/address';
import { handlesError } from '@/utils/query-client';
import { decodeOffer, type LinkOffer, type LinkSession } from '@/vault/crypto';
import { validGateway } from '@/vault/form';
import { answerOffer, receiveVaultKey } from '@/vault/link';
import { joinWithKey, normalizeGateway, unlockWithPassphrase } from '@/vault/sync';

type Method = 'scan' | 'passphrase';

// A device that had no account yet goes straight to its mail.
const leave = (firstRun: boolean) => (firstRun ? router.dismissTo('/mail') : router.back());

export default function JoinDeviceScreen() {
  const { t } = useTranslation();
  const [method, setMethod] = useState<Method>('scan');
  const [firstRun] = useState(() => getAccounts().length === 0);

  return (
    <FormScreen>
      <View style={styles.intro}>
        <ThemedText type="display">{t('settings.devices.join.headline')}</ThemedText>
        <ThemedText>{t('settings.devices.join.intro')}</ThemedText>
      </View>
      <SegmentedControl
        label={t('settings.devices.join.method')}
        options={(['scan', 'passphrase'] as const).map((value) => ({
          value,
          label: t(`settings.devices.join.methods.${value}`),
        }))}
        value={method}
        onChange={setMethod}
      />
      {method === 'scan' ? <ScanJoin firstRun={firstRun} /> : <PassphraseJoin firstRun={firstRun} />}
    </FormScreen>
  );
}

function ScanJoin({ firstRun }: { firstRun: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [offer, setOffer] = useState<LinkOffer | null>(null);
  const [foreign, setForeign] = useState(false);
  const [session, setSession] = useState<LinkSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!offer) return;
    const controller = new AbortController();
    const join = async () => {
      const answer = await answerOffer(offer);
      if (controller.signal.aborted) return;
      setSession(answer);
      const key = await receiveVaultKey(offer, answer, controller.signal);
      if (controller.signal.aborted) return;
      await joinWithKey(offer.gateway, key);
      leave(firstRun);
    };
    join().catch((cause: Error) => !controller.signal.aborted && setError(cause.message));
    return () => controller.abort();
  }, [offer, firstRun]);

  const scanned = ({ data }: BarcodeScanningResult) => {
    const offer = decodeOffer(data);
    // The code names the gateway the vault key comes from: anything but a web address is not an offer.
    const decoded = offer && validGateway(offer.gateway) ? offer : null;
    setForeign(!decoded);
    // The scanner keeps reporting the same code until the camera unmounts.
    if (decoded) setOffer((current) => current ?? decoded);
  };

  const scanAgain = () => {
    setOffer(null);
    setSession(null);
    setError(null);
  };

  if (error) {
    return (
      <View style={styles.group}>
        <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
          {error}
        </ThemedText>
        <Button label={t('settings.devices.join.scanAgain')} onPress={scanAgain} />
      </View>
    );
  }

  if (offer) {
    return (
      <View style={styles.group}>
        {session ? (
          <>
            <ThemedText>{t('settings.devices.join.compare')}</ThemedText>
            <LinkCode code={session.code} />
          </>
        ) : null}
        <View style={styles.waiting} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.muted} />
          <ThemedText type="meta">
            {session ? t('settings.devices.join.waiting') : t('settings.devices.join.connecting')}
          </ThemedText>
        </View>
        <Button label={t('common.cancel')} variant="outline" onPress={scanAgain} />
      </View>
    );
  }

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={styles.group}>
        <ThemedText>{t('settings.devices.join.cameraNeeded')}</ThemedText>
        {permission.canAskAgain ? (
          <Button label={t('settings.devices.join.allowCamera')} onPress={requestPermission} />
        ) : (
          <ThemedText type="meta">{t('settings.devices.join.cameraBlocked')}</ThemedText>
        )}
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <CameraView
        style={[styles.camera, { backgroundColor: theme.surface }]}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned}
      />
      <ThemedText type="meta" themeColor={foreign ? 'danger' : undefined} accessibilityLiveRegion="polite">
        {foreign ? t('settings.devices.join.foreignCode') : t('settings.devices.join.scanHint')}
      </ThemedText>
    </View>
  );
}

function PassphraseJoin({ firstRun }: { firstRun: boolean }) {
  const { t } = useTranslation();
  const [gateway, setGateway] = useState('');
  const [email, setEmail] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const unlock = useMutation({
    meta: handlesError,
    mutationFn: () => unlockWithPassphrase(normalizeGateway(gateway), email.trim(), passphrase, false),
    onSuccess: () => leave(firstRun),
  });

  const ready = validGateway(gateway) && isEmail(email.trim()) && passphrase.length > 0;

  return (
    <View style={styles.group}>
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
      <TextField
        value={email}
        onChangeText={setEmail}
        placeholder={t('settings.devices.email')}
        accessibilityLabel={t('settings.devices.email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <TextField
        value={passphrase}
        onChangeText={setPassphrase}
        onSubmitEditing={() => ready && unlock.mutate()}
        placeholder={t('settings.devices.passphrase')}
        accessibilityLabel={t('settings.devices.passphrase')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        secureTextEntry
        returnKeyType="go"
      />
      {unlock.isError && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
          {unlock.error.message}
        </ThemedText>
      )}
      <Button
        label={t('settings.devices.join.unlock')}
        onPress={() => unlock.mutate()}
        disabled={!ready}
        loading={unlock.isPending}
      />
      {unlock.isPending && (
        <ThemedText type="meta" accessibilityLiveRegion="polite">
          {t('settings.devices.deriving')}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.three,
  },
  camera: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
