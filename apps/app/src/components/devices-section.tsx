import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Row, Section } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { listTime } from '@/utils/time';
import { useVault } from '@/vault/sync';

export function useSyncStatus() {
  const { t } = useTranslation();
  const { syncedAt, syncing } = useVault();
  if (syncing) return t('settings.devices.syncing');
  if (syncedAt) return t('settings.devices.syncedAt', { time: listTime(syncedAt / 1000) });
  return t('settings.devices.notSynced');
}

export function DevicesSection() {
  const { t } = useTranslation();
  const { gateway, error } = useVault();
  const status = useSyncStatus();

  if (!gateway) {
    return (
      <Section title={t('settings.devices.title')}>
        <Row
          title={t('settings.devices.sync')}
          detail={t('settings.devices.off')}
          chevron
          onPress={() => router.push('/sync-setup')}
        />
        <Row title={t('settings.devices.joinDevice')} chevron onPress={() => router.push('/join-device')} />
        <Row title={t('settings.devices.shareAccounts')} chevron onPress={() => router.push('/share-accounts')} />
        <Row title={t('settings.devices.backupAccounts')} chevron onPress={() => router.push('/backup-accounts')} />
        <ThemedText type="meta">{t('settings.devices.offHint')}</ThemedText>
      </Section>
    );
  }

  return (
    <Section title={t('settings.devices.title')}>
      <Row title={t('settings.devices.sync')} detail={status} chevron onPress={() => router.push('/sync')} />
      <Row title={t('settings.devices.linkDevice')} chevron onPress={() => router.push('/link-device')} />
      <Row title={t('settings.devices.shareAccounts')} chevron onPress={() => router.push('/share-accounts')} />
      <Row title={t('settings.devices.backupAccounts')} chevron onPress={() => router.push('/backup-accounts')} />
      {error && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      )}
    </Section>
  );
}
