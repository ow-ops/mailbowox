import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Swipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  interpolateColor,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { thresholdHaptic } from '@/utils/haptics';

import type { SwipeAction, SwipeActionsProps } from '@/components/swipe-action';

// A release past this distance runs the action; the panel fills with the action's color once it is reached.
const THRESHOLD = 96;

export function SwipeActions({ leading, trailing, enabled, children }: SwipeActionsProps) {
  const ref = useRef<SwipeableMethods>(null);
  const run = (direction: SwipeDirection) => {
    const action = direction === SwipeDirection.RIGHT ? leading : trailing;
    action.run();
    if (!action.removes) ref.current?.close();
  };
  return (
    <Swipeable
      ref={ref}
      enabled={enabled}
      leftThreshold={THRESHOLD}
      rightThreshold={THRESHOLD}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={(_progress, translation) => <Panel action={leading} edge={1} translation={translation} />}
      renderRightActions={(_progress, translation) => <Panel action={trailing} edge={-1} translation={translation} />}
      onSwipeableWillOpen={run}>
      {children}
    </Swipeable>
  );
}

// Both panels span the row and sit on top of each other, so each shows only while the row moves its way.
function Panel({ action, edge, translation }: { action: SwipeAction; edge: 1 | -1; translation: SharedValue<number> }) {
  const theme = useTheme();
  const armed = useDerivedValue(() => translation.value * edge >= THRESHOLD);
  const fill = useDerivedValue(() => withTiming(armed.value ? 1 : 0, { duration: 120 }));
  const color = action.tone === 'danger' ? theme.danger : theme.primary;

  useAnimatedReaction(
    () => armed.value,
    (now, before) => {
      if (before !== null && now !== before) scheduleOnRN(thresholdHaptic);
    },
  );

  const panel = useAnimatedStyle(() => ({
    opacity: translation.value * edge > 0 ? 1 : 0,
    backgroundColor: interpolateColor(fill.value, [0, 1], [theme.surface, color]),
  }));
  const idle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const ready = useAnimatedStyle(() => ({ opacity: fill.value }));

  const content = (tint: string) => (
    <>
      <SymbolView name={action.icon} size={22} tintColor={tint} />
      <ThemedText type="labelSmall" style={{ color: tint }}>
        {action.label}
      </ThemedText>
    </>
  );

  return (
    <Animated.View
      style={[styles.panel, edge === 1 ? styles.leading : styles.trailing, panel]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={styles.slot}>
        <Animated.View style={[styles.content, idle]}>{content(theme.muted)}</Animated.View>
        <Animated.View style={[styles.content, styles.over, ready]}>{content(theme.onPrimary)}</Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  leading: {
    alignItems: 'flex-start',
  },
  trailing: {
    alignItems: 'flex-end',
  },
  slot: {
    minWidth: THRESHOLD - Spacing.four * 2,
  },
  content: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  over: {
    ...StyleSheet.absoluteFill,
  },
});
