import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Press, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Explanation } from '@/core/errors';

type Props = Explanation & { centered?: boolean };

// The plain sentence first; the server's or database's text stays one tap away for bug reports.
export function ErrorExplanation({ summary, detail, centered = false }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const align = centered ? styles.centered : styles.start;
  return (
    <View style={[styles.container, align]}>
      <ThemedText type="meta" themeColor="text" style={centered && styles.centeredText}>
        {summary}
      </ThemedText>
      {detail !== '' && (
        <Pressable
          onPress={() => setOpen(!open)}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.toggle, pressed && { opacity: Press.opacity }]}>
          <ThemedText type="labelSmall" themeColor="muted">
            {t('common.details')}
          </ThemedText>
          <SymbolView
            name={
              open
                ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }
                : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
            }
            size={12}
            tintColor={theme.muted}
          />
        </Pressable>
      )}
      {open && (
        <ThemedText type="meta" selectable style={centered && styles.centeredText}>
          {detail}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  start: { alignItems: 'flex-start' },
  centered: { alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
