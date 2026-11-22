# mailbowox desktop

A [Tauri](https://tauri.app) shell around the web build of `apps/app`. It adds two things a browser doesn't have:

- The gateway's relay, on `127.0.0.1` with a free port and a per-launch code, so no relay has to be hosted or typed in.
- `mail.db` and `contacts.db` as SQLite files in the app data directory. expo-sqlite's web build needs `SharedArrayBuffer`, which the macOS webview withholds.

The app finds both through `apps/app/src/utils/desktop.ts`.

## Run

Build the core for the web first (`pnpm ubrn:web` in `packages/core-native`). Then, from the repo root:

```sh
mise run desktop          # dev window, Expo dev server on port 8090
mise run desktop:build    # app bundle and installers, in src-tauri/target/release/bundle
```

Linux needs the WebKitGTK packages Tauri [lists](https://tauri.app/start/prerequisites/#linux).

The crate is outside the root Cargo workspace: run `cargo test` and `cargo clippy` from `src-tauri`.
