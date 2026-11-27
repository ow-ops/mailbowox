import { useTranslation } from 'react-i18next';

import { Section, ToggleRow } from '@/components/settings';
import { crashReportsAvailable, setCrashReports, useCrashReports } from '@/crash-reports';

export function CrashReportSettings() {
  const { t } = useTranslation();
  const on = useCrashReports();
  if (!crashReportsAvailable) return null;
  return (
    <Section title={t('settings.crashReports.title')} footer={t('settings.crashReports.explanation')}>
      <ToggleRow title={t('settings.crashReports.toggle')} value={on} onValueChange={setCrashReports} />
    </Section>
  );
}
