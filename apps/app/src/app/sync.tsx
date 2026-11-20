import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSyncStatus } from '@/components/devices-section';
import { Row, Section, SettingsScreen } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { confirmAction } from '@/utils/dialog';
import { handlesError } from '@/utils/query-client';
import { showError } from '@/utils/toast';
import { deleteVault, syncVault, turnOffVault, useVault } from '@/vault/sync';

export default function SyncScreen() {
  const { t } = useTranslation();
  const { gateway, syncing, error } = useVault();
  const status = useSyncStatus();

  const turnOff = () =>
    confirmAction(t('settings.devices.turnOffConfirm'), t('settings.devices.turnOff'), () => {
      router.back();
      void turnOffVault();
    });

  const remove = useMutation({
    mutationFn: deleteVault,
    meta: handlesError,
    onSuccess: () => router.back(),
    onError: (cause) => showError(t('common.actionFailed'), cause.message),
  });

  return (
    <SettingsScreen title={t('settings.devices.sync')}>
      <Section>
        <Row title={t('settings.devices.server')} detail={gateway?.replace(/^https?:\/\//, '')} />
        <Row
          title={t('settings.devices.syncNow')}
          detail={status}
          loading={syncing}
          onPress={() => void syncVault().catch(() => undefined)}
        />
        {error && (
          <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
            {error}
          </ThemedText>
        )}
        <ThemedText type="meta">{t('settings.devices.onHint')}</ThemedText>
      </Section>

      <Section>
        <Row title={t('settings.devices.turnOff')} destructive onPress={turnOff} />
        <Row
          title={t('settings.devices.delete')}
          destructive
          loading={remove.isPending}
          onPress={() => confirmAction(t('settings.devices.deleteConfirm'), t('settings.devices.delete'), () => remove.mutate())}
        />
      </Section>
    </SettingsScreen>
  );
}
