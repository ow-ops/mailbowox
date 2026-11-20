import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';

// `removes`: the action takes the row out of the list, so it stays swiped away instead of closing.
export type SwipeAction = {
  icon: SymbolViewProps['name'];
  label: string;
  tone: 'primary' | 'danger';
  removes: boolean;
  run: () => void;
};

export type SwipeActionsProps = { leading: SwipeAction; trailing: SwipeAction; enabled: boolean; children: ReactNode };
