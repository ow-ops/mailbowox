#![allow(dead_code, reason = "each test binary uses a different subset")]
#![expect(
    clippy::expect_used,
    clippy::panic,
    reason = "test failures should stop the test at the failed assertion"
)]

use std::{
    net::{TcpStream, ToSocketAddrs},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use mailbowox_core::{
    AccountConfig, Address, Credentials, Draft, MailSession, MessageSummary, Security,
    ServerConfig, send_message,
};

pub(crate) const PASSWORD: &str = "mailbowox-dev";

/// Where dev/mailbox's Stalwart listens: CI reaches it by its compose service name.
pub(crate) fn host() -> String {
    std::env::var("MAILBOWOX_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into())
}

/// The Stalwart from dev/mailbox, or `None` when it is not running. CI always expects it.
pub(crate) fn local_server() -> Option<()> {
    let host = host();
    let up = (host.as_str(), 1143)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok());
    if up {
        return Some(());
    }
    assert!(
        std::env::var_os("CI").is_none(),
        "no IMAP server on {host}:1143 (CI runs dev/mailbox/setup.sh)"
    );
    eprintln!("skipped: no IMAP server on {host}:1143 (run dev/mailbox/setup.sh)");
    None
}

pub(crate) fn account(user: &str) -> AccountConfig {
    let email = format!("{user}@mailbowox.test");
    let host = host();
    AccountConfig {
        display_name: user.to_owned(),
        imap: ServerConfig {
            host: host.clone(),
            port: 1143,
            security: Security::Plain,
        },
        smtp: ServerConfig {
            host: host.clone(),
            port: 1587,
            security: Security::Plain,
        },
        credentials: Credentials {
            username: email.clone(),
            password: PASSWORD.into(),
        },
        carddav_url: Some(format!("http://{host}:18080")),
        email,
    }
}

pub(crate) async fn connect(user: &str) -> Arc<MailSession> {
    MailSession::connect(account(user)).await.expect("connect")
}

pub(crate) async fn uid_validity(session: &MailSession, mailbox: &str) -> u32 {
    session
        .sync(mailbox.to_owned(), None, Vec::new(), 0)
        .await
        .expect("select mailbox")
        .state
        .uid_validity
}

pub(crate) fn unique(label: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after 1970")
        .as_nanos();
    format!("{label} {nanos}")
}

pub(crate) fn draft(from: &str, to: &str, subject: &str, text: &str) -> Draft {
    Draft {
        from: Address {
            name: Some(from.to_owned()),
            email: format!("{from}@mailbowox.test"),
        },
        to: vec![Address {
            name: None,
            email: format!("{to}@mailbowox.test"),
        }],
        cc: Vec::new(),
        bcc: Vec::new(),
        subject: subject.to_owned(),
        text: text.to_owned(),
        html: None,
        in_reply_to: None,
        references: Vec::new(),
        attachments: Vec::new(),
    }
}

pub(crate) async fn bob_sends_alice(subject: &str, text: &str) -> Vec<u8> {
    send_message(account("bob"), draft("bob", "alice", subject, text))
        .await
        .expect("bob sends to alice")
}

/// Syncs `mailbox` from scratch until a message with `subject` shows up.
pub(crate) async fn wait_for_subject(
    session: &MailSession,
    mailbox: &str,
    subject: &str,
) -> MessageSummary {
    for _ in 0..50 {
        let result = session
            .sync(mailbox.to_owned(), None, Vec::new(), 100)
            .await
            .expect("sync");
        if let Some(found) = result.changed.into_iter().find(|m| m.subject == subject) {
            return found;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    panic!("{subject:?} never reached {mailbox}");
}
