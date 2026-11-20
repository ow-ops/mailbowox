# mailbowox

Mail and contacts client for iOS, Android and the web. Connects to your provider over IMAP, SMTP and CardDAV.

Status: pre-release. The app has no store listing yet.

## Get the app

Android: install with Obtainium, or download the APK from the [releases](https://git.ow-ops.eu/ow-ops/mailbowox/releases).

Install [Obtainium](https://obtainium.imranr.dev), then tap **Add to Obtainium**. Stable and nightly have different package ids, so you can install both.

**Stable**

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%7B%22id%22%3A%22eu.owops.mailbowox%22%2C%22url%22%3A%22https%3A%2F%2Fgit.ow-ops.eu%2Fow-ops%2Fmailbowox%22%2C%22author%22%3A%22ow-ops%22%2C%22name%22%3A%22mailbowox%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22A%20mail%20and%20contacts%20client%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>

**Nightly**, built from every change to `main`:

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%7B%22id%22%3A%22eu.owops.mailbowox.nightly%22%2C%22url%22%3A%22https%3A%2F%2Fgit.ow-ops.eu%2Fow-ops%2Fmailbowox%22%2C%22author%22%3A%22ow-ops%22%2C%22name%22%3A%22mailbowox%20Nightly%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22A%20mail%20and%20contacts%20client%20(nightly)%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22includePrereleases%5C%22%3Atrue%2C%5C%22filterReleaseTitlesByRegEx%5C%22%3A%5C%22%5ENightly%20build%20%5C%22%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>

## Layout

| Path | What it holds |
| --- | --- |
| `apps/app` | Expo app (expo-router, zustand, TanStack Query, expo-sqlite). Strings are in `src/i18n/locales/{en,fr}`. |
| `crates/core` | Rust core: IMAP, SMTP and CardDAV clients, MIME parsing and sanitising, server discovery. Exposed through UniFFI. |
| `packages/core-native` | Generated React Native and WASM bindings for the core (`uniffi-bindgen-react-native`). |
| `crates/gateway` | axum service: WebSocket-to-TCP relay for the web build, encrypted sync vault, IMAP IDLE watcher for push pings. See its [README](crates/gateway/README.md). |
| `dev/mailbox` | Local Stalwart server with two test accounts, for integration and end-to-end tests. |

## Development

Install [mise](https://mise.jdx.dev), then from the repo root:

```sh
mise install                 # Rust, Node, pnpm, lint and audit tools, pinned
pnpm install
dev/mailbox/setup.sh         # the test mail server; needs Docker
```

The bindings are generated, not committed. Build them after cloning and after every change to the core's exported API. Add the mobile targets once, the pinned toolchain has none:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-linux-android x86_64-linux-android
cd packages/core-native
pnpm ubrn:ios                # or ubrn:android with NDK_HOME set, or ubrn:web; see crates/gateway/README.md for the web build
```

Then from `apps/app`, run a development build (Expo Go can't load the core):

```sh
pnpm ios                     # or pnpm android
```

In the app, add `alice@mailbowox.test`, password `mailbowox-dev`, server `127.0.0.1`, ports 1143 (IMAP) and 1587 (SMTP), security None. All ports are in [dev/mailbox/README.md](dev/mailbox/README.md).

### Commands

| Command | Does |
| --- | --- |
| `mise run fmt` | `cargo fmt` and `taplo fmt` |
| `mise run lint` | rustfmt, clippy, cargo-machete, taplo, typos, then the app's `tsc`, eslint and knip |
| `mise run test` | `cargo nextest` for the workspace and jest for the app |
| `mise run audit` | `cargo deny` and `pnpm audit --prod` |
| `mise run check` | all of the above |

The Rust integration tests need the test mail server (`dev/mailbox/setup.sh`), otherwise they skip. `lefthook install` sets up git hooks: quick checks on commit, `cargo deny` on push.

### End-to-end tests

Maestro flows in `apps/app/e2e`, see [apps/app/e2e/README.md](apps/app/e2e/README.md).

## Privacy

- The mobile app connects directly to your provider over TLS. The web app connects over TLS through a relay that forwards encrypted traffic.
- Remote images stay blocked until you allow them. Message HTML is sanitised and rendered in a web view with JavaScript off.
- There are no analytics. Crash reports are opt-in, off by default, and only in builds made with a Sentry DSN.
- Account sync and new-mail notifications are opt-in. Sync encrypts account settings on your device before upload. The push gateway holds your IMAP password to watch the inbox, so its operator can access your mail. See [SECURITY.md](SECURITY.md) for details.

## License

[MIT](LICENSE)
