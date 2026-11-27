import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';

import type { MenuPickerProps } from '@/components/menu-picker';
import { useTheme } from '@/hooks/use-theme';

export function MenuPicker<T extends string>({ label, options, value, onChange }: MenuPickerProps<T>) {
  const theme = useTheme();
  return (
    <Host matchContents>
      <Picker
        label={label}
        selection={value}
        onSelectionChange={(next: T) => onChange(next)}
        modifiers={[pickerStyle('menu'), tint(theme.primary), accessibilityLabel(label)]}>
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
