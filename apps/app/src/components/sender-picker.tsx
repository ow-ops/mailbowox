import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Row } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { Hairline, Press, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { sameSender, type Sender } from '@/mail/from';

type Props = { senders: Sender[]; value: Sender; onChange: (sender: Sender) => void };

// The picked address sits on the From line; opening it lists every address of every account beneath it.
export function SenderPicker({ senders, value, onChange }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('compose.from')}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={t('compose.fromLine', { email: value.address.email })}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.line, { borderBottomColor: theme.border }, pressed && { opacity: Press.opacity }]}>
        <ThemedText type="meta" style={styles.label}>
          {t('compose.from')}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.address}>
          {value.address.email}
        </ThemedText>
        <SymbolView
          name={
            open
              ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }
              : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
          }
          size={14}
          tintColor={theme.muted}
        />
      </Pressable>
      {open &&
        senders.map((sender) => (
          <Row
            key={`${sender.account}/${sender.address.email}`}
            title={sender.address.email}
            detail={sender.address.name}
            selected={sameSender(sender, value)}
            onPress={() => {
              onChange(sender);
              setOpen(false);
            }}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: Hairline,
  },
  label: {
    minWidth: 56,
  },
  address: {
    flex: 1,
  },
});
