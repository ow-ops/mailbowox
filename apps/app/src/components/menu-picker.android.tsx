import { DropdownMenu, DropdownMenuItem, Host, RNHostView, Text } from '@expo/ui/jetpack-compose';
import { useState } from 'react';

import { Button } from '@/components/button';
import type { MenuPickerProps } from '@/components/menu-picker';
import { useScheme, useTheme } from '@/hooks/use-theme';

export function MenuPicker<T extends string>({ label, options, value, onChange }: MenuPickerProps<T>) {
  const theme = useTheme();
  const scheme = useScheme();
  const [expanded, setExpanded] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <Host matchContents colorScheme={scheme}>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)} color={theme.surface}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <Button
              label={current?.label ?? label}
              accessibilityLabel={`${label}: ${current?.label ?? ''}`}
              variant="outline"
              size="small"
              onPress={() => setExpanded(true)}
            />
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {expanded &&
            options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                elementColors={{ textColor: theme.heading }}
                onClick={() => {
                  setExpanded(false);
                  onChange(option.value);
                }}>
                <DropdownMenuItem.Text>
                  <Text>{option.label}</Text>
                </DropdownMenuItem.Text>
                {option.value === value && (
                  <DropdownMenuItem.TrailingIcon>
                    <Text>✓</Text>
                  </DropdownMenuItem.TrailingIcon>
                )}
              </DropdownMenuItem>
            ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
