import { useEffect } from 'react';

import { useScheme, useTheme } from '@/hooks/use-theme';

import './browser.css';

export function useBrowserTheme() {
  const theme = useTheme();
  const scheme = useScheme();
  useEffect(() => {
    const root = document.documentElement.style;
    root.colorScheme = scheme;
    root.setProperty('--focus', theme.primary);
    root.setProperty('--selection', theme.accentSoft);
    root.setProperty('--scrollbar', theme.outline);
  }, [theme, scheme]);
}
