import { Linking, Platform, StyleSheet } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';
import { bodyDocument, bodyScheme } from '@/mail/body-document';

// Only the document itself loads inside the view; a tapped link opens in the system browser.
function onNavigate(request: WebViewNavigation) {
  if (request.url === 'about:blank' || request.url.startsWith('data:')) return true;
  if (Platform.OS === 'ios' && request.navigationType !== 'click') return false;
  if (/^(https?|mailto):/i.test(request.url)) void Linking.openURL(request.url);
  return false;
}

export function MailBody({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const scheme = bodyScheme(html, useScheme());
  return (
    <WebView
      source={{ html: bodyDocument(html, allowRemote, scheme) }}
      originWhitelist={['*']}
      javaScriptEnabled={false}
      onShouldStartLoadWithRequest={onNavigate}
      setSupportMultipleWindows={false}
      style={[styles.body, { backgroundColor: Colors[scheme].page }]}
    />
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
