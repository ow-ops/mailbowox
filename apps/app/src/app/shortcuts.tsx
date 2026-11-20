import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { KeyCap } from '@/components/key-cap';
import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Hairline, Spacing } from '@/constants/theme';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useTheme } from '@/hooks/use-theme';

export default function ShortcutsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  useShortcuts({ Escape: router.back, '?': router.back });

  const rows: [string[], string][] = [
    [['j', 'k'], t('mail.shortcuts.move')],
    [['o', t('mail.shortcuts.enter')], t('mail.shortcuts.open')],
    [['u', t('mail.shortcuts.escape')], t('mail.shortcuts.back')],
    [['e'], t('mail.actions.archive')],
    [['#'], t('mail.actions.delete')],
    [['s', '*'], t('mail.shortcuts.flag')],
    [['r'], t('mail.actions.reply')],
    [['a'], t('mail.actions.replyAll')],
    [['f'], t('mail.actions.forward')],
    [['c'], t('mail.compose')],
    [['/'], t('mail.search.label')],
    [['?'], t('mail.shortcuts.title')],
  ];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {rows.map(([keys, label]) => (
        <View key={label} style={[styles.row, { borderBottomColor: theme.border }]}>
          <ThemedText style={styles.label}>{label}</ThemedText>
          <View style={styles.keys}>
            {keys.map((key) => (
              <KeyCap key={key} label={key} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: ColumnWidth, alignSelf: 'center', padding: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 48,
    borderBottomWidth: Hairline,
  },
  label: { flex: 1 },
  keys: { flexDirection: 'row', gap: Spacing.one },
});
