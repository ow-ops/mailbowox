import { router, usePathname } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { MailboxList, MailboxRow } from '@/components/mailbox-list';
import { ShortcutTooltip } from '@/components/shortcut-tooltip';
import { ThemedText } from '@/components/themed-text';
import { Hairline, MailboxPaneWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setMailView, useMailView, type MailView } from '@/mail/view';

export function WebSidebar() {
  const { t } = useTranslation();
  const theme = useTheme();
  const pathname = usePathname();
  const view = useMailView();
  const onMail = pathname.startsWith('/mail');

  const openMailbox = (next: MailView) => {
    setMailView(next);
    if (!onMail) router.navigate('/mail');
  };
  const section = (href: '/calendar' | '/contacts' | '/settings', label: string, icon: SymbolViewProps['name']) => (
    <MailboxRow
      icon={icon}
      label={label}
      selected={pathname.startsWith(href)}
      onPress={() => router.navigate(href)}
    />
  );

  return (
    <View style={[styles.sidebar, { borderRightColor: theme.border }]}>
      <View style={styles.top}>
        <ThemedText type="wordmark">mailbowox</ThemedText>
        <ShortcutTooltip label={t('mail.compose')} shortcut="c">
          <Button label={t('mail.compose')} onPress={() => router.push('/compose')} />
        </ShortcutTooltip>
      </View>
      <View style={styles.mailboxes}>
        <MailboxList current={onMail ? view : null} onSelect={openMailbox} />
      </View>
      <View style={[styles.sections, { borderTopColor: theme.border }]}>
        {section('/calendar', t('calendar.tab'), { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' })}
        {section('/contacts', t('contacts.tab'), { ios: 'person.crop.circle', android: 'contacts', web: 'contacts' })}
        {section('/settings', t('settings.tab'), { ios: 'gearshape', android: 'settings', web: 'settings' })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: MailboxPaneWidth, borderRightWidth: Hairline },
  top: {
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three + Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  mailboxes: { flex: 1 },
  sections: { padding: Spacing.two, gap: Spacing.half, borderTopWidth: Hairline },
});
