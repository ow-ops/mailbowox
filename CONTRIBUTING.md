# Contributing

## Layout

| Path | What it holds |
| --- | --- |
| `apps/app` | Expo app (expo-router, zustand, TanStack Query). Strings are in `src/i18n/locales/{en,fr}`. |
| `apps/desktop` | Tauri shell that runs the web build as a desktop app, with a relay and the store's SQLite files of its own. See its [README](apps/desktop/README.md). |
| `crates/core` | Rust core: IMAP, SMTP and CardDAV clients, MIME parsing and sanitising, server discovery, and the mail store (sync, conversations, paging, search). Exposed through UniFFI. |
| `crates/sql` | The store's SQLite, as batches of statements: run beside the core natively, in an OPFS worker on the web (`crates/sql-worker`), and in the desktop shell. |
| `packages/core-native` | Generated React Native and WASM bindings for the core (`uniffi-bindgen-react-native`). |
| `crates/gateway` | axum service: WebSocket-to-TCP relay for the web build, encrypted sync vault, IMAP IDLE watcher for push pings. See its [README](crates/gateway/README.md). |
| `dev/mailbox` | Local Stalwart server with two test accounts, for integration and end-to-end tests. |

## Setup

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

## Commands

| Command | Does |
| --- | --- |
| `mise run fmt` | `cargo fmt` and `taplo fmt` |
| `mise run lint` | rustfmt, clippy, cargo-machete, taplo, typos, then the app's `tsc`, eslint and knip |
| `mise run test` | `cargo nextest` for the workspace and jest for the app |
| `mise run audit` | `cargo deny` and `pnpm audit --prod` |
| `mise run check` | all of the above |

The Rust integration tests need the test mail server (`dev/mailbox/setup.sh`), otherwise they skip. `lefthook install` sets up git hooks: quick checks on commit, `cargo deny` on push.

## End-to-end tests

Maestro flows in `apps/app/e2e`, see [apps/app/e2e/README.md](apps/app/e2e/README.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org), scope when one fits, title line only, no body:

```
fix(app): keep the undo toast reachable on Android
feat(gateway): rate-limit the api routes per client
ci: build the APK and AAB in parallel
```

git-cliff builds the changelog from the titles, so say what changed for the user. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `ci`, `chore`. No `!` on dependency or CI updates, past 1.0.0 it forces a major bump.

## Checks

`mise run check` runs what CI runs. Before a PR, at least:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo nextest run --workspace --all-features       # needs dev/mailbox/setup.sh
cargo deny --all-features check
cd apps/app && npx tsc --noEmit && pnpm lint && pnpm test && pnpm dlx knip
```

Add a test for what you add or fix, named for the behaviour. After changing anything the core exports, regenerate the bindings (`pnpm ubrn:ios` or `pnpm ubrn:android` in `packages/core-native`) and update `apps/app/src/core/types.ts`.

## Code

- Comments only for a non-obvious why.
- No options, abstractions or error variants that nothing uses.
- Prefer a maintained library over hand-rolled code.
- Add app dependencies with `npx expo install <package>` from `apps/app`, to match the Expo SDK. Never edit `apps/app/ios` or `apps/app/android`, they're generated. Change `app.json` or a config plugin.

## Translations

Every user-facing string, accessibility labels and errors included, goes through i18next with entries in both `apps/app/src/i18n/locales/en` and `fr`.

## Releasing

1. Run the **Bump version** workflow. `auto` picks the version from the commit types; `patch`, `minor`, `major` or `X.Y.Z` also work. It sets `expo.version` in `apps/app/app.json`, regenerates `CHANGELOG.md`, commits and pushes the `vX.Y.Z` tag.
2. The tag starts **Release**. It builds the core bindings and a signed APK, attaches it to a Forgejo release with the changelog entry, then builds the AAB for Google Play and the IPA for TestFlight and updates the App Store listing.
3. The build number is the commit count (`scripts/ci/resolve-release.sh` in the kit repo).

On `main`, **Release** also publishes `git.ow-ops.eu/ow-ops/mailbowox-web` and rebuilds `git.ow-ops.eu/ow-ops/mailbowox-gateway` when its sources or build workflow change. To rebuild either image manually, run **Release** and select the image.

### Secrets

Set in the repo's Forgejo settings. A job missing its secrets is skipped, except the APK build, which needs the Android ones.

| Name | Kind | Used for |
| --- | --- | --- |
| `FORGE_TOKEN` | secret | User token with write access: version bump, release upload, registry login. Must be a user token so the pushed tag starts Release. |
| `ANDROID_KEY_BASE64` | secret | Release keystore (PKCS12), base64. |
| `ANDROID_KEY_ALIAS` | secret | Key alias. |
| `ANDROID_KEY_PASSWORD` | secret | Password of the keystore and the key. |
| `PLAY_SERVICE_ACCOUNT_JSON` | secret | Google Play service account JSON, for the AAB. |
| `APP_STORE_API_KEY_BASE64` | secret | App Store Connect API key (`.p8`), base64. |
| `APP_STORE_API_KEY_ID` | secret | Key ID. |
| `APP_STORE_API_ISSUER_ID` | secret | Issuer ID. |
| `APP_REVIEW_DEMO_USER`, `APP_REVIEW_DEMO_PASSWORD` | secret | Test mail account for App Store review. |
| `TESTFLIGHT_GROUPS` | variable | Comma-separated TestFlight groups that get each build. Without it, internal testers only. |
| `SENTRY_DSN` | variable | Sentry DSN, baked in as `EXPO_PUBLIC_SENTRY_DSN`. Without it the app has no crash reporting option. |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | secret | Sentry org and project slugs, and an auth token with `project:write`, to upload source maps and debug symbols. If any is missing the upload is off (`SENTRY_DISABLE_AUTO_UPLOAD`); the build passes but reports are unsymbolicated. |

`ITSAppUsesNonExemptEncryption` is `true` (own TLS stack and vault encryption), so each build waits for an export compliance answer in App Store Connect until an encryption compliance code is added.
