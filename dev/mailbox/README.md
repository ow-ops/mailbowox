# Test mailbox

Local [Stalwart](https://stalw.art) server with two accounts, for development and integration tests.

```sh
./setup.sh             # start the server and apply plan.ndjson (safe to re-run)
docker compose down -v # stop it and delete its data
```

| | |
|---|---|
| Accounts | `alice@mailbowox.test`, `bob@mailbowox.test`, password `mailbowox-dev` |
| Alias | `hello@mailbowox.test` delivers to alice, who can also send from it |
| IMAP | `127.0.0.1:1143` plain, `127.0.0.1:1993` TLS (self-signed) |
| SMTP submission | `127.0.0.1:1587` plain, `127.0.0.1:1465` TLS (self-signed) |
| CardDAV | `http://127.0.0.1:18080/dav/` |
| Admin | `http://127.0.0.1:18080/admin`, `admin` / `mailbowox-dev` |

Plain-text login is on for the plain ports so tests need no certificate. Never use this config outside a local machine.

The plain ports and 18080 use the same numbers inside the container, so a container on the compose network reaches them as `stalwart:1143` etc. The Rust tests connect to `MAILBOWOX_TEST_HOST` (default `127.0.0.1`). Without a server the tests skip, or fail if `CI` is set.
