import { useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAvatar } from '@/contacts/avatars';
import { initials } from '@/contacts/format';

type Props = { name: string; photo?: string; email?: string; size?: number };

// The contact's own photo, else the picture found for the address, else initials.
export function ContactAvatar({ name, photo, email, size = 40 }: Props) {
  const theme = useTheme();
  const found = useAvatar(photo ? undefined : email).data ?? undefined;
  const [failed, setFailed] = useState<string>();
  const source = photo ?? found;
  const frame = { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.surface };
  const shown = source && source !== failed ? source : undefined;
  return (
    <View style={[styles.frame, frame]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shown && Platform.OS !== 'web' && /\.svg(\?|$)/i.test(shown) ? (
        <SvgUri uri={shown} width={size} height={size} onError={() => setFailed(shown)} />
      ) : shown ? (
        <Image source={{ uri: shown }} style={frame} onError={() => setFailed(shown)} />
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
