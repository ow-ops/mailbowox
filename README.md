# mailbowox

Your mail and contacts on iOS, Android and the web, from any provider that offers IMAP and SMTP. No account with us, no ads, no tracking.

Status: pre-release. The app has no store listing yet.

## What it does

- **All your accounts in one place.** An All inboxes view across accounts, plus each account's own folders, and an All unread view.
- **Conversations.** Replies are grouped with the message they answer, your own replies from Sent included.
- **Works offline.** Mail you've opened stays readable, and messages you write offline are sent once you're back online.
- **Search** across your mailboxes, with `from:`, `to:`, `subject:`, `is:unread`, `is:starred` and `has:attachment`.
- **Quick triage.** Swipe to archive or mark as read, select several messages at once, and undo an archive, a delete or a send.
- **Unsubscribe in one tap** from mailing lists.
- **Contacts** synced with your provider over CardDAV, suggested as you type an address.
- **Send-from addresses and signatures** per account.
- **Your accounts on all your devices.** Link a new device with a code from one you already use, so you never type a password twice. Account settings are encrypted on your device before they leave it.
- **New-mail notifications**, if you turn them on.
- Keyboard shortcuts on the web, light and dark themes, English and French.

Gmail and Outlook aren't supported yet.

## Get the app

Android: install with Obtainium, or download the APK from the [releases](https://git.ow-ops.eu/ow-ops/mailbowox/releases).

Install [Obtainium](https://obtainium.imranr.dev), then tap **Add to Obtainium**. Stable and nightly have different package ids, so you can install both.

**Stable**

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%7B%22id%22%3A%22eu.owops.mailbowox%22%2C%22url%22%3A%22https%3A%2F%2Fgit.ow-ops.eu%2Fow-ops%2Fmailbowox%22%2C%22author%22%3A%22ow-ops%22%2C%22name%22%3A%22mailbowox%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22A%20mail%20and%20contacts%20client%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>

**Nightly**, built from every change to `main`:

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%7B%22id%22%3A%22eu.owops.mailbowox.nightly%22%2C%22url%22%3A%22https%3A%2F%2Fgit.ow-ops.eu%2Fow-ops%2Fmailbowox%22%2C%22author%22%3A%22ow-ops%22%2C%22name%22%3A%22mailbowox%20Nightly%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22A%20mail%20and%20contacts%20client%20(nightly)%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22includePrereleases%5C%22%3Atrue%2C%5C%22filterReleaseTitlesByRegEx%5C%22%3A%5C%22%5ENightly%20build%20%5C%22%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>

## Privacy

- The mobile app connects directly to your provider over TLS. The web app connects over TLS through a relay that forwards encrypted traffic.
- Remote images stay blocked until you allow them. Message HTML is sanitised and rendered in a web view with JavaScript off.
- There are no analytics. Crash reports are opt-in, off by default, and only in builds made with a Sentry DSN.
- Account sync and new-mail notifications are opt-in. Sync encrypts account settings on your device before upload. The push gateway holds your IMAP password to watch the inbox, so its operator can access your mail. See [SECURITY.md](SECURITY.md) for details.

## Feedback

Report a bug or ask for a feature in the [issue tracker](https://git.ow-ops.eu/ow-ops/mailbowox/issues). For a security problem, follow [SECURITY.md](SECURITY.md) instead.

## Contributing

How the code is laid out, how to build it and how to run the checks: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
