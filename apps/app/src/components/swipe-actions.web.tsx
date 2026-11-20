import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/icon-button';
import type { SwipeActionsProps } from '@/components/swipe-action';
import { Hairline, Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Pointers do not swipe, so the same two actions float over the row while it is hovered.
export function SwipeActions({ leading, trailing, enabled, children }: SwipeActionsProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <View onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      {children}
      {enabled && hovered && (
        <View style={[styles.actions, { backgroundColor: theme.field, borderColor: theme.border }]}>
          {[leading, trailing].map((action) => (
            <IconButton key={action.label} icon={action.icon} label={action.label} onPress={action.run} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.two,
    flexDirection: 'row',
    paddingHorizontal: Spacing.one,
    borderWidth: Hairline,
    borderRadius: Radius.md,
    boxShadow: Shadow.raised,
  },
});
