import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { scheduleOnRN } from 'react-native-worklets';
import { fitContainer, Gallery, type VerticalPullOptions } from 'react-native-zoom-toolkit';

import { ThemedText } from '@/components/themed-text';
import { Overlay, Spacing } from '@/constants/theme';

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1000;
const BUTTON = 36;

// Images open zoomable and drag away; PDFs, text and office documents show in a web view, from the file the
// reader saved. Nothing in it runs: the attachment comes from a stranger as much as any message does.
export default function AttachmentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { uri, name, mimeType } = useLocalSearchParams<{ uri: string; name: string; mimeType: string }>();
  const [chromeVisible, setChromeVisible] = useState(true);
  const pull = useSharedValue(0);
  const image = mimeType.startsWith('image/');
  const folder = uri.slice(0, uri.lastIndexOf('/') + 1);
  const barHeight = insets.top + Spacing.two + BUTTON + Spacing.two;

  // The gallery calls this on the UI thread.
  const onVerticalPull = ({ translateY, released, velocityY }: VerticalPullOptions) => {
    'worklet';
    if (!released) {
      pull.value = translateY;
    } else if (Math.abs(translateY) > DISMISS_DISTANCE || Math.abs(velocityY) > DISMISS_VELOCITY) {
      scheduleOnRN(router.back);
    } else {
      pull.value = withSpring(0);
    }
  };
  const backdrop = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(pull.value), [0, height / 2], [1, 0.3], 'clamp'),
  }));
  const content = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  return (
    // A native modal sits outside the app's root gesture view, so pinch and double tap need their own.
    <GestureHandlerRootView style={styles.container}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]} />
      {image ? (
        <Animated.View style={[styles.container, content]}>
          <Gallery
            data={[uri]}
            keyExtractor={(item) => item}
            renderItem={(item) => <ZoomableImage uri={item} label={name} />}
            onTap={() => setChromeVisible((v) => !v)}
            onVerticalPull={onVerticalPull}
          />
        </Animated.View>
      ) : (
        <WebView
          source={{ uri }}
          allowingReadAccessToURL={folder}
          originWhitelist={['file://*']}
          javaScriptEnabled={false}
          style={[styles.container, styles.backdrop, { marginTop: barHeight, marginBottom: insets.bottom }]}
        />
      )}

      {(chromeVisible || !image) && (
        <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]}>
          <ScrimButton
            icon={{ ios: 'xmark', android: 'close', web: 'close' }}
            label={t('mail.reader.close')}
            onPress={() => router.back()}
          />
          <ThemedText type="label" numberOfLines={1} style={styles.title}>
            {name}
          </ThemedText>
          <ScrimButton
            icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
            label={t('mail.reader.share')}
            onPress={() => void Sharing.shareAsync(uri, { mimeType })}
          />
        </View>
      )}
    </GestureHandlerRootView>
  );
}

function ZoomableImage({ uri, label }: { uri: string; label: string }) {
  const { width, height } = useWindowDimensions();
  const [aspect, setAspect] = useState(1);
  return (
    <Image
      source={{ uri }}
      style={fitContainer(aspect, { width, height })}
      resizeMode="contain"
      onLoad={(e) => setAspect(e.nativeEvent.source.width / e.nativeEvent.source.height)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    />
  );
}

function ScrimButton({ icon, label, onPress }: { icon: SymbolViewProps['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel={label} style={styles.button}>
      <SymbolView name={icon} size={18} tintColor={Overlay.onScrim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: Overlay.onScrim,
  },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Overlay.scrim,
  },
});
