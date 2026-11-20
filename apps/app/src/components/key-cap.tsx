import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function KeyCap({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.cap, { borderColor: theme.outline, backgroundColor: theme.surface }]}>
      <ThemedText type="labelSmall">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  cap: {
    minWidth: 26,
    alignItems: 'center',
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderWidth: BorderWidth.input,
    borderBottomWidth: BorderWidth.input * 2,
    borderRadius: Radius.sm,
  },
});
