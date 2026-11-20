import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColumnWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function FormScreen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: theme.page }}
      contentContainerStyle={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      bottomOffset={Spacing.three}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <View style={[styles.column, { paddingBottom: insets.bottom + Spacing.four }]}>{children}</View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  column: {
    width: '100%',
    maxWidth: ColumnWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
});
