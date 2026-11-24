import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { IconButton } from '@/components/icon-button';
import { useTheme } from '@/hooks/use-theme';

// iOS shows PDFs, images, text and office documents in a web view, from the file the reader saved. Nothing in
// it runs: the attachment comes from a stranger as much as any message does.
export default function AttachmentScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { uri, name, mimeType } = useLocalSearchParams<{ uri: string; name: string; mimeType: string }>();
  const folder = uri.slice(0, uri.lastIndexOf('/') + 1);
  return (
    <>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <IconButton
              icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
              label={t('mail.reader.share')}
              onPress={() => void Sharing.shareAsync(uri, { mimeType })}
            />
          ),
        }}
      />
      <WebView
        source={{ uri }}
        allowingReadAccessToURL={folder}
        originWhitelist={['file://*']}
        javaScriptEnabled={false}
        style={[styles.view, { backgroundColor: theme.page }]}
      />
    </>
  );
}

const styles = StyleSheet.create({ view: { flex: 1 } });
