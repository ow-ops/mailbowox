const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Crash reports are opt-in and carry no replay or feedback widget, so Metro leaves that code out of the web bundle.
const config = getSentryExpoConfig(__dirname, { includeWebReplay: false, includeWebFeedback: false });

// expo-sqlite on web runs a WebAssembly build that needs SharedArrayBuffer, so cross-origin isolation.
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
