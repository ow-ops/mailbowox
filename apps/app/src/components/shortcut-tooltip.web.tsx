import * as Tooltip from '@radix-ui/react-tooltip';

import type { ShortcutTooltipProps } from '@/components/shortcut-tooltip';
import { ThemedText } from '@/components/themed-text';
import { Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ShortcutTooltip({ label, shortcut, children }: ShortcutTooltipProps) {
  const theme = useTheme();
  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span style={{ display: 'inline-flex' }}>{children}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={Spacing.one}
            collisionPadding={Spacing.two}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: Spacing.two,
              padding: `${Spacing.one}px ${Spacing.two}px`,
              borderRadius: Radius.sm,
              background: theme.heading,
              boxShadow: Shadow.raised,
              zIndex: 1000,
            }}>
            <ThemedText type="labelSmall" style={{ color: theme.page }}>
              {label}
            </ThemedText>
            {shortcut && (
              <ThemedText type="labelSmall" style={{ color: theme.border }}>
                {shortcut}
              </ThemedText>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
