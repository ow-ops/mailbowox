import { LogBox, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toaster } from 'sonner-native';

import { Hairline, Radius, Spacing } from '@/constants/theme';
import { useScheme, useTheme } from '@/hooks/use-theme';

// Tab bar sits above the system inset: 49pt on iOS, 80dp for Material 3's navigation bar. sonner-native
// counts its offset from the screen edge, so the toast clears both.
const TAB_BAR = Platform.OS === 'ios' ? 49 : 80;

// sonner-native stacks toasts absolutely in a container with no height. Android leaves views drawn outside
// their parent out of the accessibility tree, so without room TalkBack never reaches Undo.
const TOAST_ROOM = 120;

// sonner-native 0.27 hands Reanimated dependency arrays on native too, where they are ignored. Each toast
// then raises the warning, and in development its banner covers the toast's Undo button.
LogBox.ignoreLogs(['[Reanimated] Dependencies should only be used on the web']);

export function AppToaster() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Toaster
      theme={useScheme()}
      position="bottom-center"
      offset={insets.bottom + TAB_BAR + Spacing.two}
      icons={{ info: null }}
      positionerStyle={{ height: TOAST_ROOM }}
      toastOptions={{
        style: {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderWidth: Hairline,
          borderRadius: Radius.md,
          paddingVertical: Spacing.oneHalf,
        },
        titleStyle: { color: theme.heading },
        actionButtonStyle: { backgroundColor: theme.primary, borderRadius: Radius.sm, paddingHorizontal: Spacing.three },
        actionButtonTextStyle: { color: theme.onPrimary },
        descriptionStyle: { color: theme.text },
      }}
    />
  );
}
