import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAccounts } from '@/accounts/store';
import { AccountDot } from '@/components/account-mark';
import { CrashReportSettings } from '@/components/crash-report-settings';
import { DevicesSection } from '@/components/devices-section';
import { RelaySettings } from '@/components/relay-settings';
import { ChoiceRow, Row, Section, SettingsScreen, ToggleRow } from '@/components/settings';
import { useScheme, useThemeState } from '@/hooks/use-theme';
import { PREF_OPTIONS, setPref, usePref } from '@/prefs/store';
import { APPEARANCES, setAppearance } from '@/theme/store';
import { asksForRelay } from '@/utils/relay';

export default function SettingsTab() {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const remoteContent = usePref('remoteContent');
  const conversations = usePref('conversations');
  const inboxCategories = usePref('inboxCategories');
  const contactPictures = usePref('contactPictures');
  const remoteSenders = usePref('remoteSenders');
  const { appearance, themes, selected } = useThemeState();
  const scheme = useScheme();
  const themeInUse = themes.find((theme) => theme.id === selected[scheme])?.name ?? t('settings.themes.default');

  return (
    <SettingsScreen title={t('settings.tab')} tabRoot>
      <Section title={t('settings.accounts.title')}>
        {accounts.map((account) => (
          <Row
            key={account.id}
            title={account.displayName || account.email}
            detail={account.displayName ? account.email : undefined}
            leading={accounts.length > 1 ? <AccountDot account={account} /> : undefined}
            chevron
            onPress={() => router.push({ pathname: '/account', params: { id: account.id } })}
          />
        ))}
        <Row title={t('settings.accounts.add')} chevron onPress={() => router.push('/add-account')} />
      </Section>

      <Section title={t('settings.appearance.title')}>
        <ChoiceRow
          title={t('settings.appearance.mode')}
          options={APPEARANCES.map((value) => ({ value, label: t(`settings.appearance.${value}`) }))}
          value={appearance}
          onChange={setAppearance}
        />
        <Row
          title={t('settings.appearance.themes')}
          value={themeInUse}
          chevron
          onPress={() => router.push('/themes')}
        />
      </Section>

      <Section title={t('settings.reading.title')}>
        <ToggleRow
          title={t('settings.reading.conversations')}
          detail={t('settings.reading.conversationsDetail')}
          value={conversations}
          onValueChange={(value) => setPref('conversations', value)}
        />
        <ToggleRow
          title={t('settings.reading.categories')}
          detail={t('settings.reading.categoriesDetail')}
          value={inboxCategories}
          onValueChange={(value) => setPref('inboxCategories', value)}
        />
      </Section>

      <Section title={t('settings.privacy.title')}>
        <ChoiceRow
          title={t('settings.privacy.remoteContent')}
          detail={t('settings.privacy.remoteHint')}
          options={PREF_OPTIONS.remoteContent.map((value) => ({ value, label: t(`settings.privacy.remote.${value}`) }))}
          value={remoteContent}
          onChange={(value) => setPref('remoteContent', value)}
        />
        {remoteContent === 'ask' && remoteSenders.length > 0 && (
          <Row
            title={t('settings.privacy.remoteSenders')}
            value={t('settings.privacy.remoteSendersCount', { count: remoteSenders.length })}
            chevron
            onPress={() => router.push('/remote-senders')}
          />
        )}
        <ToggleRow
          title={t('settings.privacy.pictures')}
          detail={t('settings.privacy.picturesDetail')}
          value={contactPictures}
          onValueChange={(value) => setPref('contactPictures', value)}
        />
      </Section>

      <DevicesSection />

      {asksForRelay() && <RelaySettings />}

      <CrashReportSettings />

      <Section title={t('settings.about.title')} footer={t('settings.about.privacy')}>
        <Row title={t('settings.about.version')} value={Constants.expoConfig?.version} />
      </Section>
    </SettingsScreen>
  );
}
