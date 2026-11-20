import * as Menu from '@radix-ui/react-menu';
import { Fragment, useState, type CSSProperties } from 'react';

import { IconButton } from '@/components/icon-button';
import { BorderWidth, Radius, Shadow, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// icon: an SF Symbol name, shown by the iOS menu only.
type MenuItem = { key: string; title: string; icon: string; onPress: () => void };

export type NativeMenuProps = { label: string; groups: MenuItem[][] };

const css = `
  [data-mailbowox-menu-item][data-highlighted] { background: var(--menu-highlight); }
  [data-mailbowox-menu-item][data-highlighted]:focus-visible { outline: 2px solid var(--menu-ring); outline-offset: -2px; }
`;

export function NativeMenu({ label, groups }: NativeMenuProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Anchor style={{ display: 'inline-flex' }}>
        <IconButton
          icon={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
          label={label}
          onPress={() => setOpen(true)}
        />
      </Menu.Anchor>
      <Menu.Portal>
        <Menu.Content
          aria-label={label}
          side="top"
          align="start"
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
              {items.map((item) => (
                <Menu.Item
                  key={item.key}
                  data-mailbowox-menu-item=""
                  onSelect={item.onPress}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: TouchTarget - Spacing.one,
                    padding: `0 ${Spacing.three}px`,
                    borderRadius: Radius.sm,
                    cursor: 'pointer',
                    outline: 'none',
                    userSelect: 'none',
                    font: '16px -apple-system, system-ui, Roboto, sans-serif',
                    color: theme.heading,
                  }}>
                  {item.title}
                </Menu.Item>
              ))}
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
