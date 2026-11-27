import { useColorScheme } from 'react-native';
import { useStore } from 'zustand';

import { useShownAccount } from '@/mail/view';
import { resolvePalette, themeStore } from '@/theme/store';
import type { ThemeKind } from '@/theme/theme-file';

export type Scheme = ThemeKind;

export function useThemeState() {
  return useStore(themeStore);
}

// The appearance setting wins over the system, which without one is dark, as ow-ops defaults to it.
export function useScheme(): Scheme {
  const system = useColorScheme();
  const { appearance } = useThemeState();
  if (appearance !== 'system') return appearance;
  return system === 'light' ? 'light' : 'dark';
}

export function usePalette(kind: Scheme) {
  const account = useShownAccount();
  return resolvePalette(useThemeState(), kind, account?.email.toLowerCase());
}

export function useTheme() {
  return usePalette(useScheme());
}
