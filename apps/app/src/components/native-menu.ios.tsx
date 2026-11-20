import { Button, Divider, Host, Image, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, contentShape, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Fragment } from 'react';

import type { NativeMenuProps } from '@/components/native-menu';
import { useTheme } from '@/hooks/use-theme';

export function NativeMenu({ label, groups }: NativeMenuProps) {
  const theme = useTheme();
  return (
    <Host style={{ width: 44, height: 44 }} alignment="center">
      <Menu
        // A Menu is tappable only where its label draws, so the frame goes on the label.
        label={
          <Image
            systemName="ellipsis"
            color={theme.muted}
            modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel(label)]}
          />
        }>
        {groups.map((items, index) => (
          <Fragment key={items[0].key}>
            {index > 0 && <Divider />}
            {items.map((item) => (
              <Button key={item.key} label={item.title} systemImage={item.icon as never} onPress={item.onPress} />
            ))}
          </Fragment>
        ))}
      </Menu>
    </Host>
  );
}
