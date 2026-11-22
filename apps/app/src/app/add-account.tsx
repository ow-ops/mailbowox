import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addAccount, hasAccount, useAccounts } from '@/accounts/store';
import { pinAccountColor } from '@/accounts/use-account-color';
import { Button } from '@/components/button';
import { ErrorExplanation } from '@/components/error-explanation';
import { RelayForm } from '@/components/relay-settings';
import { SegmentedControl } from '@/components/segmented-control';
import { SectionTitle } from '@/components/settings';
import { SignInSteps, type SignInStep } from '@/components/sign-in-steps';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Press, Spacing, TouchTarget } from '@/constants/theme';
import { core, type AccountConfig, type DiscoveredSettings, type DiscoverySource, type Security } from '@/core';
import { useTheme } from '@/hooks/use-theme';
import { isEmail } from '@/mail/address';
import { explainError } from '@/core/errors';
import { handlesError } from '@/utils/query-client';
import { savedRelayRefusesCode } from '@/utils/relay';
import { usePref } from '@/prefs/store';

type Protocol = 'imap' | 'smtp';
type ServerDraft = { host: string; port: string; security: Security };
type Servers = Record<Protocol, ServerDraft> & { username: string; carddavUrl: string };

const PORTS: Record<Protocol, Record<Security, string>> = {
  imap: { tls: '993', startTls: '143', plain: '143' },
  smtp: { tls: '465', startTls: '587', plain: '25' },
};

// Plain connections exist for the local test server only.
const SECURITIES: Security[] = __DEV__ ? ['tls', 'startTls', 'plain'] : ['tls', 'startTls'];

const blank = (email: string): Servers => ({
  imap: { host: '', port: PORTS.imap.tls, security: 'tls' },
  smtp: { host: '', port: PORTS.smtp.tls, security: 'tls' },
  username: email.trim(),
  carddavUrl: '',
});

// A server the probe didn't reach starts blank, for the user to fill in.
const fromDiscovered = (found: DiscoveredSettings, email: string): Servers => {
  const empty = blank(email);
  return {
    imap: found.imap ? { ...found.imap, port: String(found.imap.port) } : empty.imap,
    smtp: found.smtp ? { ...found.smtp, port: String(found.smtp.port) } : empty.smtp,
    username: found.username,
    carddavUrl: found.carddavUrl ?? '',
  };
};

const validPort = (port: string) => /^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536;

const validUrl = (url: string) => !url.trim() || /^https?:\/\/[^\s/]+/i.test(url.trim());

// What still keeps the servers from being usable, as the key of the line that asks for it.
function missingServerField(servers: Servers) {
  for (const protocol of ['imap', 'smtp'] as const) {
    if (!servers[protocol].host.trim()) return `${protocol}Host` as const;
    if (!validPort(servers[protocol].port)) return `${protocol}Port` as const;
  }
  if (!servers.username.trim()) return 'username';
  if (!validUrl(servers.carddavUrl)) return 'davUrl';
  return undefined;
}

// An explicitly configured contacts server must be reachable.
const lookUp = (found: Promise<string | undefined>, named: string | undefined) =>
  named ? found : found.catch(() => undefined);

export default function AddAccountScreen() {
  const firstRun = useAccounts().length === 0;
  const relayUrl = usePref('relayUrl');
  const [changingRelay, setChangingRelay] = useState(false);
  const needsRelay = Platform.OS === 'web' && firstRun && !relayUrl;

  if (needsRelay || changingRelay) {
    return (
      <Column firstRun={firstRun}>
        <RelayStep onSaved={() => setChangingRelay(false)} />
      </Column>
    );
  }
  return (
    <Column firstRun={firstRun}>
      <AccountForm firstRun={firstRun} onChangeRelay={() => setChangingRelay(true)} />
    </Column>
  );
}

function Column({ firstRun, children }: { firstRun: boolean; children?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // On the first run there is no header, so the scroll view itself starts below the status bar: Android draws it
  // transparent over the app, and content padded down would still scroll up under it.
  return (
    <KeyboardAwareScrollView
      style={[{ backgroundColor: theme.page }, firstRun && { marginTop: insets.top }]}
      contentContainerStyle={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      bottomOffset={Spacing.three}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <View style={[styles.column, { paddingBottom: insets.bottom + Spacing.four }]}>
        {firstRun && <ThemedText type="wordmark">mailbowox</ThemedText>}
        {children}
        {firstRun && children && (
          <View style={styles.join}>
            <ThemedText>{t('accounts.add.otherDevice')}</ThemedText>
            <Button label={t('accounts.add.join')} variant="outline" onPress={() => router.push('/join-device')} />
          </View>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

function RelayStep({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.intro}>
        <ThemedText type="title">{t('accounts.relay.headline')}</ThemedText>
        <ThemedText>{t('accounts.relay.intro')}</ThemedText>
      </View>
      <View style={styles.form}>
        <RelayForm submitLabel={t('accounts.add.continue')} variant="primary" onSaved={onSaved} />
      </View>
    </>
  );
}

function AccountForm({ firstRun, onChangeRelay }: { firstRun: boolean; onChangeRelay: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const relayUrl = usePref('relayUrl');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [servers, setServers] = useState<Servers | null>(null);
  const [source, setSource] = useState<DiscoverySource | null>(null);
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [step, setStep] = useState<SignInStep>('incoming');

  const domain = email.trim().split('@')[1];

  const discover = useMutation({
    meta: handlesError,
    mutationFn: async () => {
      const found = await core.discover(email.trim());
      // Discovery skips every lookup that fails, so a relay refusing them all looks like a domain without settings.
      return { found, refused: !found && Platform.OS === 'web' && (await savedRelayRefusesCode()) };
    },
    onSuccess: ({ found, refused }) => {
      if (refused) return;
      setServers(found ? fromDiscovered(found, email) : blank(email));
      setSource(found?.source ?? null);
      setEditing(!found?.imap || !found.smtp);
    },
    onError: () => {
      setServers(blank(email));
      setEditing(true);
    },
  });

  const signIn = useMutation({
    meta: handlesError,
    mutationFn: async (config: AccountConfig) => {
      setStep('incoming');
      await core.verifyIncoming(config);
      setStep('outgoing');
      await core.verifyOutgoing(config);
      setStep('contacts');
      const carddav = await lookUp(core.discoverContacts(config), config.carddavUrl);
      await addAccount(config, { carddav });
      pinAccountColor(config.email);
    },
    onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/mail')),
  });

  const duplicate = hasAccount(email);

  const missing = () => {
    if (!email.trim()) return t('accounts.add.needs.email');
    if (!isEmail(email.trim())) return t('accounts.add.needs.fullEmail');
    if (!password) return t('accounts.add.needs.password');
    const field = servers && missingServerField(servers);
    return field ? t(`accounts.add.needs.${field}`) : undefined;
  };
  const blocker = duplicate ? undefined : missing();

  // Which server failed; why it failed is the shared explanation under it.
  const failedAt = (config: AccountConfig) => {
    if (step === 'contacts') return t('accounts.signIn.failed.contacts', { url: config.carddavUrl });
    const server = step === 'incoming' ? config.imap : config.smtp;
    return t(`accounts.signIn.failed.${step}`, { host: server.host, port: server.port });
  };

  const changeEmail = (value: string) => {
    setEmail(value);
    setServers(null);
    discover.reset();
    signIn.reset();
  };

  const updateServer = (protocol: Protocol, change: Partial<ServerDraft>) => {
    if (!servers) return;
    const current = servers[protocol];
    // Switching security moves the port along with it, unless the user typed a port of their own.
    const port =
      change.security && current.port === PORTS[protocol][current.security]
        ? PORTS[protocol][change.security]
        : current.port;
    setServers({ ...servers, [protocol]: { ...current, port, ...change } });
    signIn.reset();
  };

  const updateField = (change: Partial<Pick<Servers, 'username' | 'carddavUrl'>>) => {
    if (!servers) return;
    setServers({ ...servers, ...change });
    signIn.reset();
  };

  const submit = () => {
    if (!servers) return discover.mutate();
    signIn.mutate({
      email: email.trim(),
      displayName: name.trim(),
      imap: { host: servers.imap.host.trim(), port: Number(servers.imap.port), security: servers.imap.security },
      smtp: { host: servers.smtp.host.trim(), port: Number(servers.smtp.port), security: servers.smtp.security },
      credentials: { username: servers.username.trim(), password },
      carddavUrl: servers.carddavUrl.trim() || undefined,
    });
  };

  const securityLabel = (security: Security) => t(`accounts.servers.security.${security}`);

  return (
    <>
      <View style={styles.intro}>
        <ThemedText type="title">{t('accounts.add.headline')}</ThemedText>
        <ThemedText>{t('accounts.add.intro')}</ThemedText>
        {firstRun && Platform.OS === 'web' && (
          <View style={styles.relay}>
            <ThemedText type="meta" style={styles.relayText}>
              {t('accounts.relay.through', { host: new URL(relayUrl).host })}
            </ThemedText>
            <Button label={t('accounts.relay.change')} variant="outline" size="small" onPress={onChangeRelay} />
          </View>
        )}
      </View>

      <View style={styles.form}>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder={t('accounts.add.name')}
          accessibilityLabel={t('accounts.add.name')}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
        <TextField
          value={email}
          onChangeText={changeEmail}
          placeholder={t('accounts.add.email')}
          accessibilityLabel={t('accounts.add.email')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <TextField
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            signIn.reset();
          }}
          onSubmitEditing={() => !blocker && !duplicate && submit()}
          placeholder={t('accounts.add.password')}
          accessibilityLabel={t('accounts.add.password')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          secureTextEntry
          returnKeyType="go"
        />
        {duplicate && (
          <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
            {t('accounts.add.errors.duplicate')}
          </ThemedText>
        )}
      </View>

      {discover.isPending && (
        <ThemedText type="meta" accessibilityLiveRegion="polite">
          {t('accounts.add.lookingUp', { domain })}
        </ThemedText>
      )}

      {discover.isError && (
        <View style={styles.failure} accessibilityLiveRegion="polite">
          <ThemedText type="label" themeColor="danger">
            {t('accounts.add.errors.discovery')}
          </ThemedText>
          <ErrorExplanation {...explainError(discover.error)} />
        </View>
      )}

      {discover.data?.refused && (
        <View style={styles.failure} accessibilityLiveRegion="polite">
          <ThemedText type="label" themeColor="danger">
            {t('accounts.add.errors.relayRefused')}
          </ThemedText>
          {/* The first run already has this button under the intro. */}
          {!firstRun && (
            <View style={styles.inlineAction}>
              <Button label={t('accounts.relay.change')} variant="outline" size="small" onPress={onChangeRelay} />
            </View>
          )}
        </View>
      )}

      {servers && source && !editing && (
        <View style={styles.found} accessibilityLiveRegion="polite">
          <SectionTitle title={t(`accounts.servers.found.${source}`)} />
          <ThemedText type="meta">
            {t('accounts.servers.summary.imap', { ...servers.imap, security: securityLabel(servers.imap.security) })}
          </ThemedText>
          <ThemedText type="meta">
            {t('accounts.servers.summary.smtp', { ...servers.smtp, security: securityLabel(servers.smtp.security) })}
          </ThemedText>
          <ThemedText type="meta">
            {t('accounts.servers.summary.username', { username: servers.username })}
          </ThemedText>
          {source === 'probe' && <ThemedText style={styles.note}>{t('accounts.servers.probeNote')}</ThemedText>}
          <View style={styles.inlineAction}>
            <Button
              label={t('accounts.servers.edit')}
              variant="outline"
              size="small"
              onPress={() => setEditing(true)}
            />
          </View>
        </View>
      )}

      {servers && editing && (
        <View style={styles.form}>
          {!source && !discover.isError && <ThemedText>{t('accounts.servers.notFound', { domain })}</ThemedText>}
          {(['imap', 'smtp'] as const).map((protocol) => (
            <View key={protocol} style={styles.server}>
              <SectionTitle title={t(`accounts.servers.${protocol}`)} />
              <View style={styles.hostRow}>
                <TextField
                  style={styles.host}
                  value={servers[protocol].host}
                  onChangeText={(host) => updateServer(protocol, { host })}
                  placeholder={t('accounts.servers.host')}
                  accessibilityLabel={t('accounts.servers.hostLabel', { protocol: protocol.toUpperCase() })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <TextField
                  style={styles.port}
                  value={servers[protocol].port}
                  onChangeText={(port) => updateServer(protocol, { port })}
                  placeholder={t('accounts.servers.port')}
                  accessibilityLabel={t('accounts.servers.portLabel', { protocol: protocol.toUpperCase() })}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <SegmentedControl
                label={t('accounts.servers.securityLabel', { protocol: protocol.toUpperCase() })}
                options={SECURITIES.map((value) => ({ value, label: securityLabel(value) }))}
                value={servers[protocol].security}
                onChange={(security) => updateServer(protocol, { security })}
              />
              {protocol === 'imap' && (
                <ThemedText type="meta">
                  {__DEV__
                    ? `${t('accounts.servers.securityHint')} ${t('accounts.servers.securityPlainHint')}`
                    : t('accounts.servers.securityHint')}
                </ThemedText>
              )}
            </View>
          ))}
          <View style={styles.server}>
            <SectionTitle title={t('accounts.servers.username')} />
            <TextField
              value={servers.username}
              onChangeText={(username) => updateField({ username })}
              placeholder={t('accounts.servers.username')}
              accessibilityLabel={t('accounts.servers.username')}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.server}>
            <Pressable
              onPress={() => setAdvanced(!advanced)}
              accessibilityRole="button"
              accessibilityLabel={t('accounts.servers.advanced')}
              accessibilityState={{ expanded: advanced }}
              style={({ pressed }) => [styles.disclosure, pressed && { opacity: Press.opacity }]}>
              <ThemedText type="label">{t('accounts.servers.advanced')}</ThemedText>
              <SymbolView
                name={
                  advanced
                    ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }
                    : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
                }
                size={14}
                tintColor={theme.muted}
              />
            </Pressable>
            {advanced && (
              <>
                <TextField
                  value={servers.carddavUrl}
                  onChangeText={(carddavUrl) => updateField({ carddavUrl })}
                  placeholder={t('accounts.servers.carddavPlaceholder')}
                  accessibilityLabel={t('accounts.servers.carddav')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <ThemedText
                  type="meta"
                  themeColor={validUrl(servers.carddavUrl) ? undefined : 'danger'}
                  accessibilityLiveRegion="polite">
                  {validUrl(servers.carddavUrl) ? t('accounts.servers.carddavHint') : t('accounts.servers.davUrlInvalid')}
                </ThemedText>
              </>
            )}
          </View>
        </View>
      )}

      {(signIn.isPending || signIn.isError) && <SignInSteps current={step} failed={signIn.isError} />}

      {signIn.isError && (
        <View style={styles.failure} accessibilityLiveRegion="assertive">
          <ThemedText type="label" themeColor="danger">
            {failedAt(signIn.variables)}
          </ThemedText>
          <ErrorExplanation {...explainError(signIn.error)} />
        </View>
      )}

      <View style={styles.submit}>
        <Button
          label={servers ? t('accounts.add.signIn') : t('accounts.add.continue')}
          onPress={submit}
          disabled={duplicate || !!blocker}
          loading={discover.isPending || signIn.isPending}
        />
        {blocker && (
          <ThemedText type="meta" style={styles.blocker} accessibilityLiveRegion="polite">
            {blocker}
          </ThemedText>
        )}
      </View>

      <ThemedText type="meta">{t('accounts.add.footer')}</ThemedText>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  column: {
    width: '100%',
    maxWidth: ColumnWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  intro: {
    gap: Spacing.three,
  },
  relay: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  relayText: {
    flexShrink: 1,
  },
  form: {
    gap: Spacing.three,
  },
  found: {
    gap: Spacing.one,
  },
  note: {
    marginTop: Spacing.two,
  },
  inlineAction: {
    flexDirection: 'row',
    marginTop: Spacing.two,
  },
  server: {
    gap: Spacing.two,
  },
  hostRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  host: {
    flex: 1,
  },
  port: {
    width: 96,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TouchTarget,
  },
  failure: {
    gap: Spacing.one,
  },
  submit: {
    gap: Spacing.two,
  },
  blocker: {
    textAlign: 'center',
  },
  join: {
    gap: Spacing.three,
  },
});
