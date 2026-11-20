import type { ComponentRef, Ref } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, type View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Press, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const HIT_SLOP = Platform.select({ android: 6, default: 4 });

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  size?: 'regular' | 'small';
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
  selected?: boolean;
  role?: 'button' | 'radio';
  accessibilityLabel?: string;
  ref?: Ref<ComponentRef<typeof View>>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled = false,
  loading = false,
  destructive = false,
  selected,
  role = 'button',
  accessibilityLabel,
  ref,
}: Props) {
  const theme = useTheme();
  const filled = selected ?? variant === 'primary';

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={size === 'small' ? HIT_SLOP : undefined}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        disabled: disabled || loading,
        busy: loading,
        ...(role === 'radio' ? { checked: selected } : { selected }),
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'small' ? styles.small : styles.regular,
        filled
          ? { backgroundColor: theme.primary, borderColor: theme.primary }
          : { borderColor: destructive ? theme.danger : theme.outline },
        (pressed || disabled) && { opacity: Press.opacity },
      ]}>
      {loading ? (
        <ActivityIndicator color={filled ? theme.onPrimary : destructive ? theme.danger : theme.primary} />
      ) : (
        <ThemedText
          type={size === 'small' ? 'labelSmall' : 'label'}
          style={{ color: filled ? theme.onPrimary : destructive ? theme.danger : theme.heading }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BorderWidth.input,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  regular: {
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.four,
  },
  small: {
    minHeight: 36,
    paddingHorizontal: Spacing.three,
  },
});
