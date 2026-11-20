import type { ComponentPropsWithRef } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { textStyles } from '@/components/themed-text';
import { BorderWidth, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TextField({ style, ...rest }: ComponentPropsWithRef<typeof TextInput>) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.muted}
      selectionColor={theme.primary}
      style={[styles.input, { color: theme.heading, borderColor: theme.outline, backgroundColor: theme.field }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    ...textStyles.input,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.three,
    borderWidth: BorderWidth.input,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
});
