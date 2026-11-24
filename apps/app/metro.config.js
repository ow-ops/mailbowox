const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Crash reports are opt-in and carry no replay or feedback widget, so Metro leaves that code out of the web bundle.
const config = getSentryExpoConfig(__dirname, { includeWebReplay: false, includeWebFeedback: false });

// The core and its SQLite worker are WebAssembly on the web.
config.resolver.assetExts.push('wasm');

module.exports = config;
