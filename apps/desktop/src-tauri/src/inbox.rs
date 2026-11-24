//! Watches the inbox of each account the app turned notifications on for, over IMAP IDLE, and
//! shows the newest message that arrives. It runs while the window is closed to the tray, which
//! the app's own watcher does not. The gateway does the same for phones (crates/gateway/src/push).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use backon::{BackoffBuilder, ExponentialBackoff, ExponentialBuilder};
use mailbowox_core::{Credentials, MailSession, MessageSummary, ServerConfig};
use serde::Deserialize;
use tauri::async_runtime::{JoinHandle, spawn};

const INBOX: &str = "INBOX";
/// As the app's own watcher waits (`src/mail/sync.ts`): a laptop's connection can die in its
/// sleep without a word, and nothing else would notice before the wait ends.
const IDLE_SECS: u32 = 120;
const MIN_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_mins(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Security {
    Tls,
    StartTls,
    Plain,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub security: Security,
}

/// What the app hands over for an account. The password stays in this process's memory.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watched {
    pub id: String,
    pub imap: Server,
    pub username: String,
    pub password: String,
}

impl Watched {
    fn server(&self) -> ServerConfig {
        ServerConfig {
            host: self.imap.host.clone(),
            port: self.imap.port,
            security: match self.imap.security {
                Security::Tls => mailbowox_core::Security::Tls,
                Security::StartTls => mailbowox_core::Security::StartTls,
                Security::Plain => mailbowox_core::Security::Plain,
            },
        }
    }

    fn credentials(&self) -> Credentials {
        Credentials {
            username: self.username.clone(),
            password: self.password.clone(),
        }
    }
}

/// The notification for a message: its sender, then its subject over the start of its text.
pub fn content(message: &MessageSummary) -> (String, String) {
    let title = message.from.first().map_or_else(String::new, |from| {
        from.name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| from.email.clone())
    });
    let body = [message.subject.as_str(), message.preview.as_str()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (title, body)
}

/// One watcher per account, restarted when what the app hands over changes.
#[derive(Default)]
pub struct Inboxes(Mutex<HashMap<String, (Watched, JoinHandle<()>)>>);

impl Inboxes {
    /// Watches exactly `accounts`. IDLE can't be cancelled, so a watcher stops by being aborted.
    pub fn set<F>(&self, accounts: Vec<Watched>, show: F)
    where
        F: Fn(&str, &MessageSummary) + Clone + Send + Sync + 'static,
    {
        let mut watching = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        watching.retain(|id, (current, task)| {
            let keep = accounts
                .iter()
                .any(|account| account.id == *id && account == current);
            if !keep {
                task.abort();
            }
            keep
        });
        for account in accounts {
            if watching.contains_key(&account.id) {
                continue;
            }
            let (show, id) = (show.clone(), account.id.clone());
            let task = spawn(watch(account.clone(), move |message| show(&id, message)));
            watching.insert(account.id.clone(), (account, task));
        }
    }
}

/// Watches until aborted. Only mail that arrives after the first look is shown, so turning
/// notifications on, or starting the app, announces nothing old.
pub async fn watch<F>(account: Watched, show: F)
where
    F: Fn(&MessageSummary) + Send + Sync,
{
    let mut last: Option<(u32, u32)> = None;
    let mut backoff = backoff();
    loop {
        let _ = idle(&account, &mut last, &mut backoff, &show).await;
        tokio::time::sleep(backoff.next().unwrap_or(MAX_BACKOFF)).await;
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

/// Returns only on an error: the connection dropped or the server refused.
async fn idle<F>(
    account: &Watched,
    last: &mut Option<(u32, u32)>,
    backoff: &mut ExponentialBackoff,
    show: &F,
) -> Result<(), mailbowox_core::CoreError>
where
    F: Fn(&MessageSummary) + Send + Sync,
{
    let session = MailSession::open(&account.server(), &account.credentials(), None).await?;
    let result = async {
        loop {
            let (state, _) = session.unseen(INBOX).await?;
            if let Some((validity, next)) = *last
                && validity == state.uid_validity
                && state.uid_next > next
                && let Some(message) = session.newest_since(INBOX, state, next).await?
            {
                show(&message);
            }
            *last = Some((state.uid_validity, state.uid_next));
            session
                .wait_for_changes(INBOX.to_owned(), IDLE_SECS)
                .await?;
            // Only a wait that held shows the server is back to normal.
            *backoff = self::backoff();
        }
    }
    .await;
    let _ = session.logout().await;
    result
}

#[cfg(test)]
mod tests {
    use std::net::{TcpStream, ToSocketAddrs};

    use mailbowox_core::{AccountConfig, Address, Draft, Flags, send_message};
    use tokio::time::timeout;

    use super::*;

    /// dev/mailbox's Stalwart, as the gateway's watcher tests use it.
    fn host() -> String {
        std::env::var("MAILBOWOX_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into())
    }

    fn local_server() -> bool {
        let up = (host().as_str(), 1143)
            .to_socket_addrs()
            .ok()
            .and_then(|mut addrs| addrs.next())
            .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok());
        if !up {
            eprintln!(
                "skipped: no IMAP server on {}:1143 (run dev/mailbox/setup.sh)",
                host()
            );
        }
        up
    }

    fn dev(user: &str, port: u16) -> (ServerConfig, Credentials) {
        let server = ServerConfig {
            host: host(),
            port,
            security: mailbowox_core::Security::Plain,
        };
        let credentials = Credentials {
            username: format!("{user}@mailbowox.test"),
            password: "mailbowox-dev".into(),
        };
        (server, credentials)
    }

    #[tokio::test]
    async fn shows_mail_that_arrives_after_the_first_look() {
        if !local_server() {
            return;
        }
        let alice = Watched {
            id: "alice".into(),
            imap: Server {
                host: host(),
                port: 1143,
                security: Security::Plain,
            },
            username: "alice@mailbowox.test".into(),
            password: "mailbowox-dev".into(),
        };
        let (sender, mut shown) = tokio::sync::mpsc::unbounded_channel();
        let watching = tokio::spawn(watch(alice, move |message: &MessageSummary| {
            let _ = sender.send(content(message));
        }));
        tokio::time::sleep(Duration::from_secs(1)).await;

        let (imap, credentials) = dev("bob", 1143);
        let (smtp, _) = dev("bob", 1587);
        let bob = AccountConfig {
            email: "bob@mailbowox.test".into(),
            display_name: "bob".into(),
            imap,
            smtp,
            credentials,
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
            subject: "desktop watcher subject".into(),
            text: "desktop body".into(),
            html: None,
            in_reply_to: None,
            references: Vec::new(),
            attachments: Vec::new(),
        };
        send_message(bob, draft).await.expect("bob sends to alice");

        let first = timeout(Duration::from_secs(20), shown.recv())
            .await
            .expect("the new mail showed before the timeout")
            .expect("a notification");
        watching.abort();
        assert_eq!(
            first,
            (
                "bob@mailbowox.test".into(),
                "desktop watcher subject\ndesktop body".into()
            )
        );
    }

    fn message(from: Option<(&str, Option<&str>)>, subject: &str, preview: &str) -> MessageSummary {
        MessageSummary {
            uid: 1,
            flags: Flags::default(),
            subject: subject.into(),
            from: from
                .map(|(email, name)| Address {
                    name: name.map(Into::into),
                    email: email.into(),
                })
                .into_iter()
                .collect(),
            to: Vec::new(),
            cc: Vec::new(),
            reply_to: Vec::new(),
            delivered_to: Vec::new(),
            date: 0,
            message_id: None,
            in_reply_to: None,
            references: Vec::new(),
            preview: preview.into(),
            has_attachments: false,
            size: 0,
        }
    }

    #[test]
    fn shows_the_sender_then_the_subject_over_the_preview() {
        let shown = content(&message(
            Some(("bob@example.org", Some("Bob"))),
            "Lunch?",
            "At noon.",
        ));
        assert_eq!(shown, ("Bob".into(), "Lunch?\nAt noon.".into()));
    }

    #[test]
    fn a_sender_without_a_name_is_shown_by_address_and_empty_parts_are_left_out() {
        let shown = content(&message(
            Some(("bob@example.org", Some(""))),
            "",
            "At noon.",
        ));
        assert_eq!(shown, ("bob@example.org".into(), "At noon.".into()));
        assert_eq!(
            content(&message(None, "Hi", "")),
            (String::new(), "Hi".into())
        );
    }

    #[test]
    fn reads_what_the_app_hands_over() {
        let account: Watched = serde_json::from_value(serde_json::json!({
            "id": "a1",
            "imap": { "host": "imap.example.org", "port": 993, "security": "startTls" },
            "username": "alice",
            "password": "pw",
        }))
        .unwrap();
        assert_eq!(
            account.server().security,
            mailbowox_core::Security::StartTls
        );
        assert_eq!(account.credentials().password, "pw");
    }
}
