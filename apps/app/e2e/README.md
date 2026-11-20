# End-to-end tests

Maestro flows against the local Stalwart server in `dev/mailbox`, seeded with mail between bob and alice.

Needs Docker, Maestro, Metro running, and a debug build on a booted iOS simulator (`pnpm ios`) or Android emulator (`pnpm android`).

```sh
./e2e/run.sh --device <simulator udid or emulator-5554>
```

On Android, reach the local server and Metro through adb:

```sh
for port in 8081 1143 1587 18080; do adb reverse tcp:$port tcp:$port; done
adb shell settings put secure stylus_handwriting_enabled 0
```

The second line stops Gboard's stylus tutorial covering the first text field on a fresh emulator. Give the emulator 8 GB of RAM: at 4 GB the Android 17 image swaps and every step takes seconds.

The suite and the Rust integration tests share alice and bob on this server. Don't run `cargo test` or a local gateway's push watcher during a run: their test mail pushes the seeded messages out of view.

`run.sh` recreates the server with an empty store, sends the seed messages with `seed.sh` and runs every flow in `flows/`. The app signs in as alice through the manual server form, as `mailbowox.test` has no autoconfig.
