import { Button, Divider, Host, Image, Menu, Toggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, contentShape, disabled, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Fragment } from 'react';

import { MORE_ICON } from '@/components/menu-icons';
import type { NativeMenuProps } from '@/components/native-menu';
import { useTheme } from '@/hooks/use-theme';

export function NativeMenu({ label, groups, icon = MORE_ICON, active }: NativeMenuProps) {
  const theme = useTheme();
  return (
    <Host style={{ width: 44, height: 44 }} alignment="center">
      <Menu
        // A Menu is tappable only where its label draws, so the frame goes on the label.
        label={
          <Image
            systemName={(typeof icon === 'string' ? icon : icon.ios) as never}
            color={active ? theme.primary : theme.muted}
            modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel(label)]}
          />
        }>
        {groups.map((items, index) => (
          <Fragment key={items[0].key}>
            {index > 0 && <Divider />}
            {items.map((item) =>
              item.checked === undefined ? (
                <Button key={item.key} label={item.title} systemImage={item.icon as never} onPress={item.onPress} />
              ) : (
                <Toggle
                  key={item.key}
                  label={item.title}
                  isOn={item.checked}
                  onIsOnChange={item.onPress}
                  modifiers={[disabled(item.disabled)]}
                />
              ),
            )}
          </Fragment>
        ))}
      </Menu>
    </Host>
  );
}
