import { useMutation } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { openBackup } from '@/accounts/backup';
import { importAccounts, type SharePart } from '@/accounts/share';
import { getAccounts, hasAccount, type SyncedAccount } from '@/accounts/store';
import { Button } from '@/components/button';
import { ErrorExplanation } from '@/components/error-explanation';
import { FormScreen } from '@/components/form-screen';
import { LinkCode } from '@/components/link-code';
import { LinkQr } from '@/components/link-qr';
import { LinkScanner } from '@/components/link-scanner';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { core } from '@/core';
import { explainError } from '@/core/errors';
import { useTheme } from '@/hooks/use-theme';
import { isEmail } from '@/mail/address';
import { handlesError } from '@/utils/query-client';
import { encodeOffer, type LinkOffer, type LinkSession } from '@/vault/crypto';
import { validGateway } from '@/vault/form';
import { answerOffer, receiveVaultKey, startOffer, waitForJoiner, type Offer } from '@/vault/link';
import { joinWithKey, normalizeGateway, unlockWithPassphrase } from '@/vault/sync';

type Method = 'scan' | 'show' | 'passphrase' | 'file';

type Received = { set: string; parts: number; accounts: Record<number, SyncedAccount[]> };

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
        options={(['scan', 'show', 'passphrase', 'file'] as const).map((value) => ({
          value,
          label: t(`settings.devices.join.methods.${value}`),
        }))}
        value={method}
        onChange={setMethod}
      />
      {method === 'scan' && <ScanJoin firstRun={firstRun} />}
      {method === 'show' && <ShowJoin firstRun={firstRun} />}
      {method === 'passphrase' && <PassphraseJoin firstRun={firstRun} />}
      {method === 'file' && <FileJoin firstRun={firstRun} />}
    </FormScreen>
  );
}

function ScanJoin({ firstRun }: { firstRun: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [offer, setOffer] = useState<LinkOffer | null>(null);
  const [session, setSession] = useState<LinkSession | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scanned = received ? Object.keys(received.accounts).length : 0;
  const complete = received !== null && scanned === received.parts;
  const shared = complete ? Object.values(received.accounts).flat() : [];
  const needsPasswords = shared.some((account) => !account.credentials.password && !hasAccount(account.email));

  useEffect(() => {
    if (!complete || needsPasswords) return;
    importAccounts(Object.values(received.accounts).flat()).then(
      () => leave(firstRun),
      (cause: Error) => setError(cause.message),
    );
  }, [complete, needsPasswords, received, firstRun]);

  const share = (part: SharePart) =>
    setReceived((current) => {
      // A code from another share starts over with it.
      const base = current?.set === part.set ? current : { set: part.set, parts: part.parts, accounts: {} };
      return base.accounts[part.part] ? base : { ...base, accounts: { ...base.accounts, [part.part]: part.accounts } };
    });

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

  const scanAgain = () => {
    setOffer(null);
    setSession(null);
    setReceived(null);
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

  if (needsPasswords) return <SharedPasswords accounts={shared} onDone={() => leave(firstRun)} />;

  if (complete) {
    return (
      <View style={styles.waiting} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.muted} />
        <ThemedText type="meta">{t('settings.devices.join.adding')}</ThemedText>
      </View>
    );
  }

  return (
    <LinkScanner
      hint={
        received
          ? t('settings.devices.join.scanned', { count: scanned, total: received.parts })
          : t('settings.devices.join.scanHint')
      }
      onOffer={setOffer}
      onShare={share}
    />
  );
}

function SharedPasswords({ accounts, onDone }: { accounts: SyncedAccount[]; onDone: () => void }) {
  const { t } = useTranslation();
  const missing = accounts.filter((account) => !account.credentials.password && !hasAccount(account.email));
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const add = useMutation({
    meta: handlesError,
    mutationFn: async () => {
      const typed = missing.map((account) => ({
        ...account,
        credentials: { ...account.credentials, password: passwords[account.email] },
      }));
      for (const account of typed) {
        setFailed(account.email);
        await core.verifyIncoming(account);
      }
      setFailed(null);
      await importAccounts([...accounts.filter((account) => !missing.includes(account)), ...typed]);
    },
    onSuccess: onDone,
  });

  return (
    <View style={styles.group}>
      <ThemedText>{t('settings.devices.join.passwords')}</ThemedText>
      {missing.map((account) => (
        <TextField
          key={account.email}
          value={passwords[account.email] ?? ''}
          onChangeText={(value) => setPasswords((current) => ({ ...current, [account.email]: value }))}
          placeholder={account.email}
          accessibilityLabel={t('settings.devices.join.passwordFor', { email: account.email })}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          secureTextEntry
        />
      ))}
      {add.isError && (
        <View accessibilityLiveRegion="assertive">
          {failed && (
            <ThemedText type="label" themeColor="danger">
              {t('settings.devices.join.signInFailed', { email: failed })}
            </ThemedText>
          )}
          <ErrorExplanation {...explainError(add.error)} />
        </View>
      )}
      <Button
        label={t('settings.devices.join.addAccounts')}
        onPress={() => add.mutate()}
        disabled={missing.some((account) => !passwords[account.email])}
        loading={add.isPending}
      />
    </View>
  );
}

function ShowJoin({ firstRun }: { firstRun: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [gateway, setGateway] = useState('');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [session, setSession] = useState<LinkSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!offer) return;
    const controller = new AbortController();
    const join = async () => {
      const answer = await waitForJoiner(offer, controller.signal);
      if (controller.signal.aborted) return;
      if (!answer) return setOffer(startOffer(offer.offer.gateway));
      setSession(answer);
      const key = await receiveVaultKey(offer.offer, answer, controller.signal);
      if (controller.signal.aborted) return;
      await joinWithKey(offer.offer.gateway, key);
      leave(firstRun);
    };
    join().catch((cause: Error) => !controller.signal.aborted && setError(cause.message));
    return () => controller.abort();
  }, [offer, firstRun]);

  const reset = () => {
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
        <Button label={t('common.retry')} onPress={reset} />
      </View>
    );
  }

  if (session) {
    return (
      <View style={styles.group}>
        <ThemedText>{t('settings.devices.join.compare')}</ThemedText>
        <LinkCode code={session.code} />
        <View style={styles.waiting} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.muted} />
          <ThemedText type="meta">{t('settings.devices.join.waiting')}</ThemedText>
        </View>
        <Button label={t('common.cancel')} variant="outline" onPress={reset} />
      </View>
    );
  }

  if (offer) {
    return (
      <View style={styles.group}>
        <LinkQr value={encodeOffer(offer.offer)} label={t('settings.devices.join.qrLabel')} />
        <View style={styles.waiting} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.muted} />
          <ThemedText type="meta">{t('settings.devices.join.showHint')}</ThemedText>
        </View>
        <Button label={t('common.cancel')} variant="outline" onPress={reset} />
      </View>
    );
  }

  const ready = validGateway(gateway);
  const show = () => ready && setOffer(startOffer(normalizeGateway(gateway)));

  return (
    <View style={styles.group}>
      <TextField
        value={gateway}
        onChangeText={setGateway}
        onSubmitEditing={show}
        placeholder={t('settings.devices.gatewayPlaceholder')}
        accessibilityLabel={t('settings.devices.gateway')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        returnKeyType="go"
      />
      <Button label={t('settings.devices.join.showCode')} onPress={show} disabled={!ready} />
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

function FileJoin({ firstRun }: { firstRun: boolean }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [password, setPassword] = useState('');

  const pick = useMutation({
    meta: handlesError,
    mutationFn: async () => {
      const result = await DocumentPicker.getDocumentAsync();
      if (result.canceled) return;
      const [asset] = result.assets;
      setFile({ name: asset.name, text: await (asset.file ? asset.file.text() : new File(asset.uri).text()) });
    },
  });

  const restore = useMutation({
    meta: handlesError,
    mutationFn: async () => importAccounts(await openBackup(file!.text, password)),
    onSuccess: () => leave(firstRun),
  });

  if (!file) {
    return (
      <View style={styles.group}>
        <ThemedText>{t('settings.devices.backup.restoreIntro')}</ThemedText>
        {pick.isError && (
          <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
            {pick.error.message}
          </ThemedText>
        )}
        <Button label={t('settings.devices.backup.choose')} onPress={() => pick.mutate()} loading={pick.isPending} />
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <ThemedText type="meta">{file.name}</ThemedText>
      <TextField
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => password && restore.mutate()}
        placeholder={t('settings.devices.backup.password')}
        accessibilityLabel={t('settings.devices.backup.password')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        secureTextEntry
        returnKeyType="go"
      />
      {restore.isError && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="assertive">
          {restore.error.message}
        </ThemedText>
      )}
      <Button
        label={t('settings.devices.backup.restore')}
        onPress={() => restore.mutate()}
        disabled={!password}
        loading={restore.isPending}
      />
      {restore.isPending && (
        <ThemedText type="meta" accessibilityLiveRegion="polite">
          {t('settings.devices.deriving')}
        </ThemedText>
      )}
      <Button
        label={t('settings.devices.backup.other')}
        variant="outline"
        onPress={() => {
          restore.reset();
          setPassword('');
          setFile(null);
        }}
      />
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
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
