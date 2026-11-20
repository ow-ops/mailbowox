import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { Press } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  icon: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
};

export function IconButton({ icon, label, onPress, disabled = false, active = false }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        (pressed || disabled) && { opacity: disabled ? Press.disabled : Press.opacity },
      ]}>
      <SymbolView name={icon} size={22} tintColor={active ? theme.primary : theme.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: Platform.OS === 'android' ? 48 : 44,
    minHeight: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
