# mailbowox-gateway

Optional, self-hostable server for the mailbowox app. What it can see is in
[SECURITY.md](../../SECURITY.md#the-gateway-cratesgateway).

## How it works

One process, three parts:

- **Relay** pipes WebSocket frames to mail servers for the web build, which
  can't open TCP. TLS ends in the browser, so the relay carries ciphertext.
- **Vault and link** store the encrypted account sync blob and pass encrypted
  messages between devices being linked.
- **Push** keeps an IMAP IDLE connection per registered inbox and pings the
  device through APNs or FCM with a hash of the address and the unread count.
  It adds the newest message's sender, subject and preview, encrypted to the
  device. It holds the IMAP password, sealed under `PUSH_SECRET_KEY`.

## Quick start

```bash
docker run -d --name mailbowox-gateway \
  -p 8080:8080 \
  -v gateway-data:/data \
  -e GATEWAY_TOKENS=$(openssl rand -hex 16) \
  -e PUSH_SECRET_KEY=$(openssl rand -hex 32) \
  -e ALLOWED_ORIGINS=https://mail.example.eu \
  git.ow-ops.eu/ow-ops/mailbowox-gateway:main
```

State goes to SQLite under `/data`. Put it behind a TLS proxy and set
`TRUST_PROXY=1` there. In the app, enter the gateway URL and one of the
`GATEWAY_TOKENS` as the access code.

For iOS and Android pushes, mount the APNs key and the Firebase service account
and set the `APNS_*` and `FCM_CREDENTIALS_FILE` variables below.

## Scaling

`ROLES` picks what a process serves (`api`, `relay`, `push`, all by default).
`relay` never opens the database. Several `push` processes share the inboxes
through Postgres (`DATABASE_URL=postgres://…`): each leases up to
`PUSH_CAPACITY`, and a stopped worker's inboxes move to the others within a
minute.

## Rotating the push key

Set the new key in `PUSH_SECRET_KEY` and the old one in `PUSH_OLD_SECRET_KEYS`
on every process, then restart the `push` processes. Drop the old key once this
returns 0:

```sql
SELECT COUNT(*) FROM push_registration WHERE key_id <> '<id of the current key>';
```

## Configuration

| Variable                | Default                          | Description                                                               |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `BIND`                  | `0.0.0.0:8080`                   | Listen address                                                            |
| `ROLES`                 | `api,relay,push`                 | Parts to serve                                                            |
| `DATABASE_URL`          | `sqlite:///data/gateway.db?mode=rwc` | `sqlite://…` or `postgres://…`                                         |
| `GATEWAY_TOKENS`        |                                  | Relay access codes, comma-separated. Empty refuses every relay connection |
| `ALLOWED_PORTS`         | `993,465,587,143,443`            | Ports the relay and push may connect to                                   |
| `ALLOW_PRIVATE_TARGETS` |                                  | `1` lets the relay and push reach private addresses. Local testing only  |
| `TRUST_PROXY`           |                                  | `1` rate-limits by the last `X-Forwarded-For` address                     |
| `ALLOWED_ORIGINS`       |                                  | Web origins allowed by CORS on `/vault` and `/link`                       |
| `METRICS_BIND`          |                                  | Address for Prometheus `/metrics`                                         |
| `PUSH_SECRET_KEY`       |                                  | 32-byte hex key sealing push registrations. Unset turns push off         |
| `PUSH_OLD_SECRET_KEYS`  |                                  | Earlier keys, during a rotation                                           |
| `PUSH_CAPACITY`         | `10000`                          | Most inboxes one `push` process watches                                   |
| `APNS_KEY_FILE`         |                                  | APNs `.p8` key. Without it iOS registrations answer `503`                 |
| `APNS_KEY_ID`           |                                  | Key ID of that key                                                        |
| `APNS_TEAM_ID`          |                                  | Apple team ID                                                             |
| `APNS_TOPIC`            | `eu.owops.mailbowox`             | iOS bundle ID                                                             |
| `FCM_CREDENTIALS_FILE`  |                                  | Firebase service account JSON. Without it Android registrations answer `503` |
| `RUST_LOG`              | `info`                           | Log filter                                                                |

## Install from source

```bash
cargo build --release -p mailbowox-gateway
docker build -f crates/gateway/Dockerfile -t mailbowox-gateway .
```

## Contributing

```bash
cargo test -p mailbowox-gateway   # SQLite; the IMAP tests run when dev/mailbox is up
```

Set `TEST_POSTGRES_URL` to run the tests on Postgres:

```bash
docker run -d --rm --name gateway-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:15432:5432 postgres:18-alpine
TEST_POSTGRES_URL=postgres://postgres:test@127.0.0.1:15432/postgres cargo test -p mailbowox-gateway
```

To try the web build against the local Stalwart server (`dev/mailbox`):

```bash
BIND=127.0.0.1:18787 GATEWAY_TOKENS=dev-token ALLOW_PRIVATE_TARGETS=1 \
ALLOWED_PORTS=1143,1587,18080,993,465,587,443 ALLOWED_ORIGINS=http://localhost:8081 \
cargo run -p mailbowox-gateway

cd packages/core-native && CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang pnpm ubrn:web
cd ../../apps/app && pnpm exec expo start --web
```

`ring` needs a clang that targets wasm32 (Homebrew LLVM on macOS), and
`wasm-bindgen-cli` must match the version in `Cargo.lock`. In the app, use relay
`http://127.0.0.1:18787` with access code `dev-token`, then add the account with
server `127.0.0.1`, ports 1143 and 1587, security None.
