import { Image, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { initials } from '@/contacts/format';

type Props = { name: string; photo?: string; size?: number };

export function ContactAvatar({ name, photo, size = 40 }: Props) {
  const theme = useTheme();
  const frame = { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surface };
  return (
    <View style={[styles.frame, frame]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {photo ? (
        <Image source={{ uri: photo }} style={frame} />
      ) : (
        <ThemedText themeColor="muted" style={{ fontFamily: Fonts.heading, fontSize: size * 0.38 }}>
          {initials(name)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
