import { NativeTabs } from 'expo-router/native-tabs';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { MailSync } from '@/components/mail-sync';
import { WebSidebar } from '@/components/web-sidebar';
import { useTheme } from '@/hooks/use-theme';
import { useWebSidebar } from '@/hooks/use-web-sidebar';
import { useSelecting } from '@/mail/selection';
import '@/theme/web-tabs';

export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const selecting = useSelecting();
  const sidebar = useWebSidebar();
  const tabs = (
    <NativeTabs
      sidebarAdaptable
      hidden={selecting}
      tintColor={theme.primary}
      backgroundColor={Platform.OS === 'ios' ? undefined : theme.page}
      indicatorColor={theme.accentSoft}
      labelStyle={{ selected: { color: theme.heading } }}>
      <NativeTabs.Trigger name="mail">
        <NativeTabs.Trigger.Label>{t('mail.tab')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'envelope', selected: 'envelope.fill' }} md="mail" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>{t('calendar.tab')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="contacts">
        <NativeTabs.Trigger.Label>{t('contacts.tab')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="contacts" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>{t('settings.tab')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
  return (
    <>
      <MailSync />
      {Platform.OS === 'web' ? (
        <View style={styles.web}>
          {sidebar && <WebSidebar />}
          {tabs}
        </View>
      ) : (
        tabs
      )}
    </>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, flexDirection: 'row' },
});
