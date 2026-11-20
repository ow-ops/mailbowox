import { Platform, useWindowDimensions } from 'react-native';

import { Spacing, WindowClass } from '@/constants/theme';

// Wide browser windows navigate from a sidebar; web-tabs.css hides the floating tab bar at the same width.
export function useWebSidebar() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= WindowClass.rail;
}

// Web tab screens hide their header and draw their title themselves, below the floating tab bar
// (24px from the top, 40px tall) or, beside the sidebar, at the top of the window.
export function useWebTopInset() {
  const sidebar = useWebSidebar();
  if (Platform.OS !== 'web') return 0;
  return sidebar ? Spacing.three : 24 + 40 + 16;
}
