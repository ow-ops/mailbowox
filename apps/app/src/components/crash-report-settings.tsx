import { useTranslation } from 'react-i18next';

import { Section, ToggleRow } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { crashReportsAvailable, setCrashReports, useCrashReports } from '@/crash-reports';

export function CrashReportSettings() {
  const { t } = useTranslation();
  const on = useCrashReports();
  if (!crashReportsAvailable) return null;
  return (
    <Section title={t('settings.crashReports.title')}>
      <ToggleRow title={t('settings.crashReports.toggle')} value={on} onValueChange={setCrashReports} />
      <ThemedText type="meta">{t('settings.crashReports.explanation')}</ThemedText>
    </Section>
  );
}
