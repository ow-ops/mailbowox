import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export type Scheme = keyof typeof Colors;

// Follows the system appearance; without one, dark, as ow-ops defaults to it.
export function useScheme(): Scheme {
  return useColorScheme() === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  return Colors[useScheme()];
}
