import { DropdownMenu, DropdownMenuItem, Host, HorizontalDivider, RNHostView, Text } from '@expo/ui/jetpack-compose';
import { Fragment, useState } from 'react';

import { IconButton } from '@/components/icon-button';
import type { NativeMenuProps } from '@/components/native-menu';
import { useScheme, useTheme } from '@/hooks/use-theme';

export function NativeMenu({ label, groups }: NativeMenuProps) {
  const theme = useTheme();
  const scheme = useScheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <Host matchContents colorScheme={scheme}>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)} color={theme.surface}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <IconButton
              icon={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
              label={label}
              onPress={() => setExpanded(true)}
            />
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {expanded &&
            groups.map((items, index) => (
              <Fragment key={items[0].key}>
                {index > 0 && <HorizontalDivider color={theme.border} />}
                {items.map((item) => (
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
                ))}
              </Fragment>
            ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
