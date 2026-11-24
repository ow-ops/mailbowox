# Security

## Reporting a vulnerability

No details in a public issue. Open one on https://git.ow-ops.eu/ow-ops/mailbowox that only says you have a security report and asks for a private channel. Include the affected version or commit, not the details.

We aim to acknowledge within a week and say what we'll do within a month.

## Threat model

### Without a gateway

The app and the Rust core connect straight to your IMAP, SMTP and CardDAV servers over TLS (rustls, Mozilla root store). Passwords sit in the device's secure storage. Message HTML is sanitised, remote images are blocked unless you allow them, and the message web view has JavaScript off and a content security policy.

No project server is involved. Your provider sees your mail, as always. Adding an account looks up its servers: the address's domain goes to Cloudflare (DNS over HTTPS) and to Thunderbird's provider database, and the full address to the domain's own autoconfig server when it has one. No password is sent until you sign in.

Crash reports are opt-in and off by default; [apps/app/README.md](apps/app/README.md#crash-reporting) says what they hold.

### The gateway (`crates/gateway`)

The gateway is optional and self-hostable. Three jobs:

- **Relay (web build only).** Browsers can't open TCP connections, so the web build goes through the relay, which pipes WebSocket frames to the mail server. TLS ends in the browser's WASM, so the relay carries ciphertext. It logs only byte counts and refuses private and loopback targets.
- **Vault (sync, opt-in).** Accounts, servers and passwords are encrypted on the device with XChaCha20-Poly1305 before upload. The key comes from a passphrase (Argon2id) or from scanning a code on a linked device (X25519, with a number to compare on both screens). The gateway stores an opaque blob under an id derived from the key, guarded by a bearer secret it keeps only as a hash. It sees the blob's size, when it changes and the client's IP, not the contents. Lose the passphrase and every linked device and the vault is gone. Deleting the synced data from a device empties the vault on the gateway for all of them; setting sync up again starts a new vault under a new key. The passphrase's own blob stays, holding the key of the emptied vault.
  With a passphrase, a second blob holds the vault key, under an id derived from the passphrase and the email address. **A gateway operator who knows your address can test passphrases against that id offline**, at the cost of one Argon2id run (19 MiB, 2 passes) per guess, so the passphrase is all that protects the vault from the operator: use a long random one.
- **Push (notifications, opt-in per account).** To watch an inbox the gateway logs in to it, so it holds the account's IMAP password, encrypted at rest with a key the operator sets (`PUSH_SECRET_KEY`). **A gateway operator with that key, or with access to the running process, can read the mail of every account registered for push.** Use a gateway you run or trust, and an app password if your provider offers one. A ping leaves the gateway: a hash of the address and the unread count, sent through Apple's or Google's push service, which also see the device token. It also sends the newest message's sender, subject and preview, encrypted to a key only the device holds.

### Out of scope

- A compromised device, or a malicious app or keyboard on it.
- Your mail provider.
- Metadata TLS doesn't hide, like which servers your device talks to.
- Gmail and Outlook accounts, which the app doesn't support.

## Supported versions

Only the latest release and `main` receive fixes.
