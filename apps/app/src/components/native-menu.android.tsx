import {
  DropdownMenu,
  DropdownMenuItem,
  Host,
  HorizontalDivider,
  RNHostView,
  SelectableDropdownMenuItem,
  Text,
} from '@expo/ui/jetpack-compose';
import { Fragment, useState } from 'react';

import { IconButton } from '@/components/icon-button';
import { MORE_ICON } from '@/components/menu-icons';
import type { NativeMenuProps } from '@/components/native-menu';
import { useScheme, useTheme } from '@/hooks/use-theme';

export function NativeMenu({ label, groups, icon = MORE_ICON, active }: NativeMenuProps) {
  const theme = useTheme();
  const scheme = useScheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <Host matchContents colorScheme={scheme}>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)} color={theme.surface}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <IconButton icon={icon} label={label} active={active} onPress={() => setExpanded(true)} />
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {expanded &&
            groups.map((items, index) => (
              <Fragment key={items[0].key}>
                {index > 0 && <HorizontalDivider color={theme.border} />}
                {items.map((item) =>
                  item.checked !== undefined ? (
                    // Choices stay open, so several can be set in one visit.
                    <SelectableDropdownMenuItem
                      key={item.key}
                      selected={item.checked}
                      enabled={!item.disabled}
                      colors={{
                        textColor: theme.heading,
                        selectedTextColor: theme.onAccentSoft,
                        selectedContainerColor: theme.accentSoft,
                      }}
                      onClick={item.onPress}>
                      <SelectableDropdownMenuItem.Text>
                        <Text>{item.title}</Text>
                      </SelectableDropdownMenuItem.Text>
                    </SelectableDropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      key={item.key}
                      elementColors={{ textColor: theme.heading }}
                      onClick={() => {
                        setExpanded(false);
                        item.onPress();
                      }}>
                      <DropdownMenuItem.Text>
                        <Text>{item.title}</Text>
                      </DropdownMenuItem.Text>
                    </DropdownMenuItem>
                  ),
                )}
              </Fragment>
            ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
