import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { KeyCap } from '@/components/key-cap';
import { useViewTitle } from '@/components/mail-header';
import { ThemedText } from '@/components/themed-text';
import { Press, Spacing } from '@/constants/theme';
import { useUnreadCount } from '@/mail/queries';
import type { MailView } from '@/mail/view';

export function EmptyReader({ view }: { view: MailView }) {
  const { t } = useTranslation();
  const unread = useUnreadCount(view);
  const mailbox = useViewTitle(view);
  const caption = t('mail.reader.unreadIn', { count: unread, mailbox });
  return (
    <View style={styles.screen}>
      {unread ? (
        <View accessible accessibilityRole="header" accessibilityLabel={`${unread} ${caption}`} style={styles.text}>
          <ThemedText type="title" themeColor="primary" style={styles.numeral}>
            {unread}
          </ThemedText>
          <ThemedText type="headline" style={styles.center}>
            {caption}
          </ThemedText>
        </View>
      ) : (
        <ThemedText type="display" style={styles.center} accessibilityRole="header">
          {t('mail.reader.allRead', { mailbox })}
        </ThemedText>
      )}
      <ThemedText themeColor="muted" style={styles.center}>
        {t('mail.reader.select')}
      </ThemedText>
      {Platform.OS === 'web' && (
        <View style={styles.keys}>
          <View style={styles.key}>
            <KeyCap label="j" />
            <KeyCap label="k" />
            <ThemedText type="meta">{t('mail.shortcuts.move')}</ThemedText>
          </View>
          <Pressable
            onPress={() => router.push('/shortcuts')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.key, pressed && { opacity: Press.opacity }]}>
            <KeyCap label="?" />
            <ThemedText type="meta" themeColor="primary">
              {t('mail.shortcuts.all')}
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.five },
  text: { alignItems: 'center' },
  // Display face at poster size, tight.
  numeral: {
    fontSize: 112,
    lineHeight: 112,
    letterSpacing: -5,
  },
  center: { textAlign: 'center' },
  keys: { alignItems: 'flex-start', gap: Spacing.two, marginTop: Spacing.four },
  key: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 32 },
});
