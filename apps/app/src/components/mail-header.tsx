import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { IconButton } from '@/components/icon-button';
import { ShortcutTooltip } from '@/components/shortcut-tooltip';
import { textStyles, ThemedText } from '@/components/themed-text';
import { Fonts, Press, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mailboxLabel } from '@/mail/mailboxes';
import { useMailboxes } from '@/mail/queries';
import { startSelecting, stopSelecting } from '@/mail/selection';
import { boxesOf, INBOX, type MailView } from '@/mail/view';

export function useViewTitle(view: MailView) {
  const { t } = useTranslation();
  const mailboxes = useMailboxes(boxesOf(view, useAccounts())[0].account).data?.mailboxes;
  if (view.kind === 'unified') return t('mail.allInboxes');
  if (view.kind === 'unread') return t('mail.allUnread');
  const mailbox = mailboxes?.find((m) => m.name === view.mailbox);
  return mailboxLabel(
    mailbox ?? { name: view.mailbox, role: view.mailbox === INBOX ? 'inbox' : undefined, selectable: true },
  );
}

// Web draws the title at the top of the list, not in a navigation bar, so it takes the display face.
const titleStyle = Platform.OS === 'web' ? textStyles.headline : null;

// The title opens the mailbox switcher when the mailbox list is not on screen.
export function MailboxTitle({ title, switcher }: { title: string; switcher: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const text = (
    <ThemedText numberOfLines={1} style={[styles.title, titleStyle, { color: theme.heading }]}>
      {title}
    </ThemedText>
  );
  if (!switcher) return text;
  return (
    <Pressable
      onPress={() => router.push('/mailboxes')}
      accessibilityRole="button"
      accessibilityLabel={t('mail.mailboxes.switch', { title })}
      style={({ pressed }) => [styles.switcher, pressed && { opacity: Press.opacity }]}>
      {text}
      <SymbolView
        name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
        size={14}
        tintColor={theme.primary}
      />
    </Pressable>
  );
}

function HeaderTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      style={({ pressed }) => [styles.textButton, pressed && { opacity: Press.opacity }]}>
      <ThemedText type="label" themeColor="primary">
        {label}
      </ThemedText>
    </Pressable>
  );
}

// `compose` is off where the web sidebar has its own Compose button.
export function MailActions({ compose = true }: { compose?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.actions}>
      <HeaderTextButton label={t('mail.select.start')} onPress={() => startSelecting()} />
      {compose && (
        <ShortcutTooltip label={t('mail.compose')} shortcut="c">
          <IconButton
            icon={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }}
            label={t('mail.compose')}
            active
            onPress={() => router.push('/compose')}
          />
        </ShortcutTooltip>
      )}
    </View>
  );
}

export function SelectingTitle({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <ThemedText numberOfLines={1} themeColor="heading" style={[styles.title, titleStyle]} accessibilityLiveRegion="polite">
      {count ? t('mail.select.count', { count }) : t('mail.select.title')}
    </ThemedText>
  );
}

export function SelectAllButton({ all, onPress }: { all: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return <HeaderTextButton label={all ? t('mail.select.none') : t('mail.select.all')} onPress={onPress} />;
}

export function DoneButton() {
  const { t } = useTranslation();
  return <HeaderTextButton label={t('mail.select.done')} onPress={stopSelecting} />;
}

// Web hides the native header under the floating tab bar, so the same controls sit at the top of the list.
export function InlineMailHeader({ children }: { children: ReactNode }) {
  return <View style={styles.inline}>{children}</View>;
}

const styles = StyleSheet.create({
  title: {
    fontFamily: Fonts.heading,
    fontSize: 17,
    lineHeight: 22,
  },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    maxWidth: 260,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  textButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
});
