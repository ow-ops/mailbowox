import type { ReactNode } from 'react';

export type ShortcutTooltipProps = { label: string; shortcut?: string; children: ReactNode };

// Tooltips are for pointers; touch screens get the control's accessibility label alone.
export function ShortcutTooltip({ children }: ShortcutTooltipProps) {
  return children;
}
