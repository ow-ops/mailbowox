import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import type { SegmentedControlProps } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type MenuPickerProps<T extends string> = SegmentedControlProps<T> & {
  // Web only: the select covers the nearest positioned ancestor, such as a settings row, rather than the value.
  fill?: boolean;
};

// The select lies transparent over the value, so any click opens the browser's own menu and it keeps its keyboard
// handling and focus ring.
export function MenuPicker<T extends string>({ label, options, value, onChange, fill }: MenuPickerProps<T>) {
  const theme = useTheme();
  const current = options.find((option) => option.value === value);
  return (
    <View style={[styles.value, fill && styles.static]}>
      <ThemedText aria-hidden>{current?.label}</ThemedText>
      <SymbolView
        name={{ ios: 'chevron.up.chevron.down', android: 'unfold_more', web: 'unfold_more' }}
        size={16}
        tintColor={theme.muted}
      />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        style={{
          position: 'absolute',
          inset: 0,
          appearance: 'none',
          background: 'transparent',
          border: 0,
          color: 'transparent',
          cursor: 'pointer',
        }}>
        {options.map((option) => (
          <option key={option.value} value={option.value} style={{ color: theme.heading, background: theme.surface }}>
            {option.label}
          </option>
        ))}
      </select>
    </View>
  );
}

const styles = StyleSheet.create({
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  static: {
    position: 'static',
  },
});
