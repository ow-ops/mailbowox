import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Hairline, Press, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBulkActions } from '@/mail/actions';
import { seenChange, setMovingItems, stopSelecting } from '@/mail/selection';
import type { Conversation } from '@/mail/threads';

type Props = { selected: Conversation[]; inArchive: boolean };

// Replaces the tab bar while rows are being selected.
export function SelectionBar({ selected, inArchive }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const actions = useBulkActions();
  const items = selected.flatMap((c) => c.inView);
  const accounts = new Set(items.map((item) => item.account));
  const markRead = selected.length === 0 || seenChange(selected).value;

  const done = (run: () => void) => () => {
    run();
    stopSelecting();
  };
  const move = () => {
    const mailboxes = new Set(items.map((item) => item.mailbox));
    setMovingItems(items);
    router.push({
      pathname: '/move',
      params: {
        account: items[0].account,
        selection: '1',
        ...(mailboxes.size === 1 ? { mailbox: items[0].mailbox } : {}),
      },
    });
  };

  return (
    <View
      style={[
        styles.bar,
        { borderTopColor: theme.border, backgroundColor: theme.page, paddingBottom: insets.bottom + Spacing.one },
      ]}>
      <BarButton
        icon={{ ios: 'archivebox', android: 'archive', web: 'archive' }}
        label={t('mail.actions.archive')}
        disabled={selected.length === 0 || inArchive}
        onPress={done(() => actions.archive(selected))}
      />
      <BarButton
        icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
        label={t('mail.actions.delete')}
        disabled={selected.length === 0}
        onPress={() => actions.remove(selected, stopSelecting)}
      />
      <BarButton
        icon={{ ios: 'folder', android: 'drive_file_move', web: 'drive_file_move' }}
        label={t('mail.actions.move')}
        disabled={accounts.size !== 1}
        onPress={move}
      />
      <BarButton
        icon={
          markRead
            ? { ios: 'envelope.open', android: 'drafts', web: 'drafts' }
            : { ios: 'envelope.badge', android: 'mark_email_unread', web: 'mark_email_unread' }
        }
        label={markRead ? t('mail.actions.read') : t('mail.actions.unread')}
        disabled={selected.length === 0}
        onPress={done(() => actions.toggleSeen(selected))}
      />
    </View>
  );
}

type ButtonProps = { icon: SymbolViewProps['name']; label: string; disabled: boolean; onPress: () => void };

function BarButton({ icon, label, disabled, onPress }: ButtonProps) {
  const theme = useTheme();
  const tint = disabled ? theme.muted : theme.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.button, (pressed || disabled) && { opacity: disabled ? Press.disabled : Press.opacity }]}>
      <SymbolView name={icon} size={22} tintColor={tint} />
      <ThemedText type="meta" style={{ color: tint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: Hairline,
    paddingTop: Spacing.one,
  },
  button: {
    flex: 1,
    minHeight: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
});
