import * as Menu from '@radix-ui/react-menu';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Fragment, useState, type CSSProperties } from 'react';

import { IconButton } from '@/components/icon-button';
import { MORE_ICON } from '@/components/menu-icons';
import { BorderWidth, Radius, Shadow, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// icon: an SF Symbol name, shown by the iOS menu only. An item with `checked` is a choice that stays on or off.
type MenuItem = { key: string; title: string; icon?: string; checked?: boolean; disabled?: boolean; onPress: () => void };

export type NativeMenuProps = {
  label: string;
  groups: MenuItem[][];
  icon?: SymbolViewProps['name'];
  // Tints the trigger while something the menu sets is on.
  active?: boolean;
};

const CHECK_ICON = { ios: 'checkmark', android: 'check', web: 'check' } as const;

const css = `
  [data-mailbowox-menu-item][data-highlighted] { background: var(--menu-highlight); }
  [data-mailbowox-menu-item][data-highlighted]:focus-visible { outline: 2px solid var(--menu-ring); outline-offset: -2px; }
`;

export function NativeMenu({ label, groups, icon = MORE_ICON, active }: NativeMenuProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Anchor style={{ display: 'inline-flex' }}>
        <IconButton icon={icon} label={label} active={active} onPress={() => setOpen(true)} />
      </Menu.Anchor>
      <Menu.Portal>
        <Menu.Content
          aria-label={label}
          align="end"
          sideOffset={Spacing.one}
          collisionPadding={Spacing.two}
          style={{
            '--menu-highlight': theme.border,
            '--menu-ring': theme.primary,
            minWidth: 220,
            padding: Spacing.one,
            borderRadius: Radius.md,
            border: `${BorderWidth.input}px solid ${theme.border}`,
            background: theme.surface,
            boxShadow: Shadow.overlay,
            zIndex: 1000,
          } as CSSProperties}>
          <style href="mailbowox-menu" precedence="default">
            {css}
          </style>
          {groups.map((items, index) => (
            <Fragment key={items[0].key}>
              {index > 0 && (
                <Menu.Separator
                  style={{ height: 1, margin: `${Spacing.one}px ${Spacing.two}px`, background: theme.border }}
                />
              )}
              {items.map((item) => {
                const style: CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  gap: Spacing.two,
                  minHeight: TouchTarget - Spacing.one,
                  padding: `0 ${Spacing.three}px`,
                  borderRadius: Radius.sm,
                  cursor: 'pointer',
                  outline: 'none',
                  userSelect: 'none',
                  font: '16px -apple-system, system-ui, Roboto, sans-serif',
                  color: theme.heading,
                };
                if (item.checked === undefined) {
                  return (
                    <Menu.Item key={item.key} data-mailbowox-menu-item="" onSelect={item.onPress} style={style}>
                      {item.title}
                    </Menu.Item>
                  );
                }
                return (
                  <Menu.CheckboxItem
                    key={item.key}
                    data-mailbowox-menu-item=""
                    checked={item.checked}
                    disabled={item.disabled}
                    // Choices stay open, so several can be set in one visit.
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={item.onPress}
                    style={style}>
                    <span style={{ display: 'inline-flex', width: 18 }}>
                      <Menu.ItemIndicator>
                        <SymbolView name={CHECK_ICON} size={18} tintColor={theme.primary} />
                      </Menu.ItemIndicator>
                    </span>
                    {item.title}
                  </Menu.CheckboxItem>
                );
              })}
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
