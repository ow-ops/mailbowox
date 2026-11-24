#![expect(
    clippy::expect_used,
    clippy::panic,
    reason = "test failures should stop the test at the failed assertion"
)]

mod common;

use std::time::Duration;

use mailbowox_core::{Flags, MailSession, build_message};

/// Retries while the server indexes the new message.
async fn search_until_found(session: &MailSession, query: &str, uid: u32) -> Vec<u32> {
    for _ in 0..50 {
        let found = session
            .search("INBOX".into(), query.to_owned())
            .await
            .expect("search");
        if found.uids.contains(&uid) {
            return found.uids;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    panic!("{query:?} never found UID {uid}");
}

#[tokio::test]
async fn search_matches_subject_sender_and_body_words() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let word = common::unique("quokka").replace(' ', "");
    let subject = format!("Receipt {word}");
    let raw = build_message(common::draft(
        "bob",
        "alice",
        &subject,
        "the parcel left the depot",
    ))
    .expect("build");
    let uid = alice
        .append("INBOX".into(), raw, Flags::default())
        .await
        .expect("append")
        .expect("UIDPLUS");

    search_until_found(&alice, &word, uid).await;
    search_until_found(&alice, &format!("bob {word}"), uid).await;
    search_until_found(&alice, &format!("{word} depot"), uid).await;

    let missing = alice
        .search("INBOX".into(), format!("{word} nowhere-in-this-message"))
        .await
        .expect("search");
    assert!(!missing.uids.contains(&uid));

    let summaries = alice
        .fetch_summaries("INBOX".into(), missing.uid_validity, vec![uid])
        .await
        .expect("fetch summaries");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].subject, subject);
}

#[tokio::test]
async fn search_lists_newest_first() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let word = common::unique("wombat").replace(' ', "");
    let mut uids = Vec::new();
    for n in 0..2 {
        let raw = build_message(common::draft("bob", "alice", &format!("{word} {n}"), "x"))
            .expect("build");
        let uid = alice
            .append("INBOX".into(), raw, Flags::default())
            .await
            .expect("append")
            .expect("UIDPLUS");
        uids.push(uid);
    }

    let found = search_until_found(&alice, &word, uids[1]).await;
    assert_eq!(found, [uids[1], uids[0]]);
}
