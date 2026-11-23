//! One IMAP IDLE connection per registration, on the core's `MailSession`.

use std::future::Future;
use std::time::Duration;

use backon::{BackoffBuilder, ExponentialBackoff, ExponentialBuilder};
use mailbowox_core::{AddrFilter, CoreError, MailSession, SyncState};
use tracing::debug;

use super::preview::seal;
use super::sender::{Ping, ping};
use super::{Platform, Registration, kind};

const INBOX: &str = "INBOX";
const IDLE_SECS: u32 = 29 * 60;
const MIN_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_mins(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Sent,
    /// The device token is dead: the app was uninstalled or the token rotated.
    Gone,
    Failed,
}

pub trait Notify: Sync {
    fn notify(
        &self,
        platform: Platform,
        token: &str,
        ping: &Ping,
        preview: Option<&str>,
    ) -> impl Future<Output = Delivery> + Send;
}

/// Where an inbox stood when a watcher last looked: mail arrived since if the next UID grew.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seen {
    pub uid_validity: u32,
    pub uid_next: u32,
}

impl From<SyncState> for Seen {
    fn from(state: SyncState) -> Self {
        Self {
            uid_validity: state.uid_validity,
            uid_next: state.uid_next,
        }
    }
}

/// Keeps what a watcher saw, for whichever worker watches the registration next.
pub trait Checkpoint: Sync {
    fn save(&self, seen: Seen) -> impl Future<Output = ()> + Send;
}

/// Why a watcher gave up; its registration is dropped either way.
#[derive(Debug, PartialEq, Eq)]
pub enum Stop {
    AuthFailed,
    DeviceGone,
}

/// Runs until the server refuses the credentials or the device token is gone, reconnecting
/// with backoff after any other error. `last` is where the inbox stood for the previous
/// watcher, and `allowed` the addresses the IMAP server may have, checked on every connection.
pub async fn watch(
    registration: &Registration,
    notifier: &impl Notify,
    checkpoint: &impl Checkpoint,
    allowed: Option<AddrFilter>,
    mut last: Option<Seen>,
) -> Stop {
    let mut backoff = backoff();
    loop {
        let watching = Watching {
            registration,
            notifier,
            checkpoint,
            allowed,
        };
        let error = match watching.idle(&mut last, &mut backoff).await {
            Ok(stop) => return stop,
            Err(CoreError::Auth { .. }) => return Stop::AuthFailed,
            Err(error) => error,
        };
        let delay = backoff.next().unwrap_or(MAX_BACKOFF);
        debug!(error = kind(&error), ?delay, "push watcher reconnects");
        tokio::time::sleep(delay).await;
    }
}

fn backoff() -> ExponentialBackoff {
    ExponentialBuilder::default()
        .with_min_delay(MIN_BACKOFF)
        .with_max_delay(MAX_BACKOFF)
        .with_jitter()
        .without_max_times()
        .build()
}

struct Watching<'a, N, C> {
    registration: &'a Registration,
    notifier: &'a N,
    checkpoint: &'a C,
    allowed: Option<AddrFilter>,
}

impl<N: Notify, C: Checkpoint> Watching<'_, N, C> {
    /// `last` outlives the connection, so mail that arrives while reconnecting is still pushed.
    async fn idle(
        &self,
        last: &mut Option<Seen>,
        backoff: &mut ExponentialBackoff,
    ) -> Result<Stop, CoreError> {
        let registration = self.registration;
        let session = MailSession::open(
            &registration.imap(),
            &registration.credentials(),
            self.allowed,
        )
        .await?;
        loop {
            let (state, unread) = session.unseen(INBOX).await?;
            let now = Seen::from(state);
            let arrived = last.filter(|last| {
                last.uid_validity == now.uid_validity && now.uid_next > last.uid_next
            });
            let mut delivery = Delivery::Sent;
            if let Some(since) = arrived {
                let ping = ping(&registration.email, unread);
                let preview = match &registration.keys {
                    Some(keys) => session
                        .newest_since(INBOX, state, since.uid_next)
                        .await
                        .ok()
                        .flatten()
                        .and_then(|message| seal(keys, &message)),
                    None => None,
                };
                delivery = self
                    .notifier
                    .notify(
                        registration.platform,
                        &registration.token,
                        &ping,
                        preview.as_deref(),
                    )
                    .await;
            }
            match delivery {
                Delivery::Gone => return Ok(Stop::DeviceGone),
                // The mail stays unannounced, so the next look pings for it again.
                Delivery::Failed => {}
                Delivery::Sent => {
                    if *last != Some(now) {
                        self.checkpoint.save(now).await;
                    }
                    *last = Some(now);
                }
            }
            loop {
                let changed = session
                    .wait_for_changes(INBOX.to_owned(), IDLE_SECS)
                    .await?;
                // Only a wait that held shows the server is back to normal. Resetting on login would
                // retry at once, forever, against a server that logs in and then drops the connection.
                *backoff = self::backoff();
                if changed {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::{TcpStream, ToSocketAddrs};

    use mailbowox_core::{
        AccountConfig, Address, Credentials, Draft, Security, ServerConfig, send_message,
    };
    use tokio::sync::mpsc;
    use tokio::time::timeout;

    use super::*;
    use crate::push::Security as PushSecurity;
    use crate::push::preview::tests as preview;

    /// dev/mailbox's Stalwart, which CI reaches by its compose service name.
    fn host() -> String {
        std::env::var("MAILBOWOX_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into())
    }

    fn local_server() -> bool {
        let host = host();
        let up = (host.as_str(), 1143)
            .to_socket_addrs()
            .ok()
            .and_then(|mut addrs| addrs.next())
            .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok());
        if up {
            return true;
        }
        assert!(
            std::env::var_os("CI").is_none(),
            "no IMAP server on {host}:1143 (CI runs dev/mailbox/setup.sh)"
        );
        eprintln!("skipped: no IMAP server on {host}:1143 (run dev/mailbox/setup.sh)");
        false
    }

    fn alice(password: &str) -> Registration {
        Registration {
            platform: Platform::Android,
            token: "device".into(),
            email: "alice@mailbowox.test".into(),
            host: host(),
            port: 1143,
            security: PushSecurity::Plain,
            username: "alice@mailbowox.test".into(),
            password: password.into(),
            keys: None,
        }
    }

    /// Hands each ping to the test, then reports the device gone so `watch` returns.
    struct Fake(mpsc::UnboundedSender<(Ping, Option<String>)>);

    impl Notify for Fake {
        fn notify(
            &self,
            _: Platform,
            _: &str,
            ping: &Ping,
            preview: Option<&str>,
        ) -> impl Future<Output = Delivery> {
            let _ = self.0.send((ping.clone(), preview.map(Into::into)));
            std::future::ready(Delivery::Gone)
        }
    }

    impl Checkpoint for Fake {
        fn save(&self, _: Seen) -> impl Future<Output = ()> {
            std::future::ready(())
        }
    }

    async fn bob_sends_alice() {
        let server = |port| ServerConfig {
            host: host(),
            port,
            security: Security::Plain,
        };
        let bob = AccountConfig {
            email: "bob@mailbowox.test".into(),
            display_name: "bob".into(),
            imap: server(1143),
            smtp: server(1587),
            credentials: Credentials {
                username: "bob@mailbowox.test".into(),
                password: "mailbowox-dev".into(),
            },
            carddav_url: None,
        };
        let address = |email: &str| Address {
            name: None,
            email: email.into(),
        };
        let draft = Draft {
            from: address("bob@mailbowox.test"),
            to: vec![address("alice@mailbowox.test")],
            cc: Vec::new(),
            bcc: Vec::new(),
            subject: "push watcher secret subject".into(),
            text: "secret body".into(),
            html: None,
            in_reply_to: None,
            references: Vec::new(),
            attachments: Vec::new(),
        };
        send_message(bob, draft).await.expect("bob sends to alice");
    }

    #[tokio::test]
    async fn new_mail_sends_one_content_free_ping() {
        if !local_server() {
            return;
        }
        let (sender, mut pings) = mpsc::unbounded_channel();
        let registration = alice("mailbowox-dev");
        let watching = tokio::spawn(async move {
            let fake = Fake(sender);
            watch(&registration, &fake, &fake, None, None).await
        });
        tokio::time::sleep(Duration::from_secs(1)).await;
        bob_sends_alice().await;

        let stop = timeout(Duration::from_secs(20), watching)
            .await
            .expect("the watcher pinged before the timeout")
            .expect("task");
        assert_eq!(stop, Stop::DeviceGone);
        let (ping, preview) = pings.recv().await.expect("a ping");
        assert_eq!(ping, super::ping("alice@mailbowox.test", ping.unread));
        assert!(ping.unread >= 1);
        assert_eq!(preview, None);
    }

    #[tokio::test]
    async fn a_device_with_keys_gets_the_new_message_sealed() {
        if !local_server() {
            return;
        }
        let (secret, auth, keys) = preview::device();
        let (sender, mut pings) = mpsc::unbounded_channel();
        let mut registration = alice("mailbowox-dev");
        registration.keys = Some(keys);
        let watching = tokio::spawn(async move {
            let fake = Fake(sender);
            watch(&registration, &fake, &fake, None, None).await
        });
        tokio::time::sleep(Duration::from_secs(1)).await;
        bob_sends_alice().await;

        timeout(Duration::from_secs(20), watching)
            .await
            .expect("the watcher pinged before the timeout")
            .expect("task");
        let (_, preview) = pings.recv().await.expect("a ping");
        let content = preview::open(&secret, &auth, &preview.expect("a preview"));
        assert_eq!(content["title"], "bob@mailbowox.test");
        assert_eq!(content["subtitle"], "push watcher secret subject");
        assert_eq!(content["body"], "secret body");
    }

    #[tokio::test]
    async fn mail_that_arrived_while_nobody_watched_is_pinged_at_once() {
        if !local_server() {
            return;
        }
        let registration = alice("mailbowox-dev");
        let inbox = || async {
            let session =
                MailSession::open(&registration.imap(), &registration.credentials(), None)
                    .await
                    .expect("alice logs in");
            Seen::from(session.unseen(INBOX).await.expect("inbox").0)
        };
        let before = inbox().await;
        bob_sends_alice().await;
        for _ in 0..50 {
            if inbox().await != before {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let (sender, mut pings) = mpsc::unbounded_channel();
        let fake = Fake(sender);
        let stop = timeout(
            Duration::from_secs(20),
            watch(&registration, &fake, &fake, None, Some(before)),
        )
        .await
        .expect("the watcher pinged before the timeout");
        assert_eq!(stop, Stop::DeviceGone);
        assert!(pings.recv().await.is_some());
    }

    #[tokio::test]
    async fn a_refused_address_is_never_connected_to() {
        if !local_server() {
            return;
        }
        let (sender, _pings) = mpsc::unbounded_channel();
        let fake = Fake(sender);
        // With a connection the wrong password would stop the watcher at once; refused, it only retries.
        let registration = alice("wrong password");
        let watching = watch(&registration, &fake, &fake, Some(|_| false), None);
        assert!(timeout(Duration::from_secs(2), watching).await.is_err());
    }

    #[tokio::test]
    async fn refused_credentials_stop_the_watcher() {
        if !local_server() {
            return;
        }
        let (sender, _pings) = mpsc::unbounded_channel();
        let fake = Fake(sender);
        let stop = timeout(
            Duration::from_secs(20),
            watch(&alice("wrong password"), &fake, &fake, None, None),
        )
        .await
        .expect("the watcher gave up");
        assert_eq!(stop, Stop::AuthFailed);
    }
}
