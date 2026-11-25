import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';
import { bodyDocument, bodyScheme } from '@/mail/body-document';

// The reader scrolls the body with its headers.
export const bodyFitsContent = true;

const INITIAL_HEIGHT = 120;

// Only the document itself loads inside the view; a tapped link opens in the system browser.
function onNavigate(request: WebViewNavigation) {
  if (request.url === 'about:blank' || request.url.startsWith('data:')) return true;
  if (Platform.OS === 'ios' && request.navigationType !== 'click') return false;
  if (/^(https?|mailto):/i.test(request.url)) void Linking.openURL(request.url);
  return false;
}

// Fits wide mail to the view and reports the height. The CSP still blocks the message's own scripts.
const fitAndMeasure = (width: number) => `(function () {
  var viewport = document.querySelector('meta[name=viewport]');
  var layoutWidth = ${width};
  function fit() {
    var body = document.body;
    if (${Platform.OS === 'ios'}) {
      // Once: overflow that grows with the viewport would widen it forever.
      if (layoutWidth !== ${width}) return;
      var wide = Math.max(document.documentElement.scrollWidth, body.scrollWidth);
      if (wide <= layoutWidth * 1.02) return;
      layoutWidth = wide;
      viewport.setAttribute('content', 'width=' + wide);
      return;
    }
    body.style.zoom = '1';
    var overflow = body.scrollWidth / ${width};
    body.style.zoom = String(overflow > 1.02 ? 1 / overflow : 1);
  }
  function report() {
    fit();
    var height = document.documentElement.getBoundingClientRect().height * ${width} / layoutWidth;
    window.ReactNativeWebView.postMessage(String(Math.ceil(height)));
  }
  window.addEventListener('load', report);
  new ResizeObserver(report).observe(document.documentElement);
  report();
})();
true;`;

export function MailBody({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const scheme = bodyScheme(html, useScheme());
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(INITIAL_HEIGHT);

  const onMessage = (event: WebViewMessageEvent) => {
    const measured = Number(event.nativeEvent.data);
    if (Number.isFinite(measured) && measured > 0) setHeight(measured);
  };

  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ height, backgroundColor: Colors[scheme].page }}>
      {width > 0 && (
        <WebView
          key={width}
          source={{ html: bodyDocument(html, allowRemote, scheme) }}
          originWhitelist={['*']}
          injectedJavaScript={fitAndMeasure(width)}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onNavigate}
          setSupportMultipleWindows={false}
          scrollEnabled={false}
          style={[styles.body, { backgroundColor: Colors[scheme].page }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
