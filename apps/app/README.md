# mailbowox app

Expo app for iOS, Android and the web. Mail and contacts protocols live in the Rust core (`crates/core`), loaded through `packages/core-native`.

```sh
pnpm install
(cd ../../packages/core-native && pnpm ubrn:ios)   # or ubrn:android / ubrn:web, after core changes
pnpm ios                                            # development build on the simulator
pnpm web
```

`e2e/` has the Maestro flows, run against the Stalwart server in `dev/mailbox`; see `e2e/README.md`.

## Web relay

On web the app reaches mail servers through the gateway's `/relay`. First run asks for the relay address and access code (one of the gateway's `GATEWAY_TOKENS`) and checks that `/healthz` answers before saving.

- `EXPO_PUBLIC_RELAY_URL` pre-fills the relay address at build time, for a hosted web build. The access code is still asked for: the gateway opens no connection without one.

## Hosting the web build

`pnpm exec expo export -p web` writes the site to `dist/`. `Dockerfile` serves it with Caddy (`Caddyfile`). Any other static host has to:

- send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, because expo-sqlite needs `SharedArrayBuffer`;
- serve `.wasm` as `application/wasm` and compress it;
- cache the hashed assets as immutable.

## Crash reporting

Opt-in, off by default. Settings has a "Send crash reports" switch, shown only in builds with a DSN. Reports go to Sentry via `@sentry/react-native`.

- `EXPO_PUBLIC_SENTRY_DSN` sets the DSN at build time. Without it the switch is hidden and nothing is initialised or sent.
- The choice stays on the device, not in the synced vault. Switching off closes the SDK at once.
- `sendDefaultPii` is off. No screenshots, view hierarchy, session tracking, tracing or replay; `metro.config.js` drops the web replay and feedback code from the bundle.
- `src/crash-reports/scrub.ts` runs on every event and breadcrumb. It drops user, request and extra data, console breadcrumbs and breadcrumb data, and replaces email addresses, URLs, IPs and host names in messages. Server replies quoted in an error can still hold text it can't recognise, such as a subject.
- Native crashes (Swift, Kotlin or the Rust core) are sent by the native SDK and skip the scrubber. They hold a stack trace and device details, not mail data.

To upload source maps and debug symbols, set `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` at build. Without them set `SENTRY_DISABLE_AUTO_UPLOAD=true`.

## Secrets

Account passwords and the vault key live in `expo-secure-store` on iOS and Android. They're readable after first unlock, so background sync works on a locked phone, and aren't copied to other devices through backups.

On web they're in `localStorage`, encrypted with a non-exportable AES-GCM key kept in IndexedDB. A copy of `localStorage` alone is unreadable. It doesn't help against script running in the page or someone with the whole browser profile.