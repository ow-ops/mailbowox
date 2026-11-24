#![expect(
    clippy::expect_used,
    reason = "test failures should stop the test at the failed assertion"
)]

mod common;

use mailbowox_core::{Flags, KnownMessage, MailSession, MessageSummary, build_message};

fn known(messages: &[MessageSummary]) -> Vec<KnownMessage> {
    messages
        .iter()
        .map(|message| KnownMessage {
            uid: message.uid,
            flags: message.flags,
        })
        .collect()
}

async fn append_to_inbox(session: &MailSession, label: &str) -> u32 {
    let raw =
        build_message(common::draft("bob", "alice", &common::unique(label), "x")).expect("build");
    session
        .append("INBOX".into(), raw, Flags::default())
        .await
        .expect("append")
        .expect("UIDPLUS")
}

#[tokio::test]
async fn incremental_sync_reports_flag_changes_and_vanished_uids() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let kept_uid = append_to_inbox(&alice, "kept").await;
    let deleted_uid = append_to_inbox(&alice, "deleted").await;

    let first = alice
        .sync("INBOX".into(), None, Vec::new(), 10)
        .await
        .expect("first sync");
    assert!(first.reset);
    assert!(first.changed.len() <= 10);
    assert!(
        first
            .changed
            .windows(2)
            .all(|pair| pair[0].uid > pair[1].uid)
    );

    let cached = known(&first.changed);
    let unchanged = alice
        .sync("INBOX".into(), Some(first.state), cached.clone(), 10)
        .await
        .expect("unchanged sync");
    assert!(!unchanged.reset);
    assert_eq!(unchanged.changed, []);
    assert_eq!(unchanged.vanished, [0_u32; 0]);
    assert!(!unchanged.truncated);

    let flagged = Flags {
        flagged: true,
        ..Flags::default()
    };
    alice
        .set_flags(
            "INBOX".into(),
            unchanged.state.uid_validity,
            vec![kept_uid],
            flagged,
            Flags::default(),
        )
        .await
        .expect("flag");
    alice
        .delete_messages(
            "INBOX".into(),
            unchanged.state.uid_validity,
            vec![deleted_uid],
        )
        .await
        .expect("delete");

    // A new connection carries on from what the caller has cached.
    let later = common::connect("alice").await;
    let delta = later
        .sync("INBOX".into(), Some(unchanged.state), cached, 10)
        .await
        .expect("delta sync");
    assert!(!delta.reset);
    assert_eq!(delta.changed.len(), 1);
    assert_eq!(delta.changed[0].uid, kept_uid);
    assert!(delta.changed[0].flags.flagged);
    assert_eq!(delta.vanished, vec![deleted_uid]);
}

#[tokio::test]
async fn more_new_messages_than_the_limit_are_reported_as_truncated() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    // Tests here run at once, and a message of another test's landing between
    // these appends would change the newest two, so this one gets its own mailbox.
    let mailbox = common::unique("truncation");
    alice.create_mailbox(mailbox.clone()).await.expect("create");
    let before = alice
        .sync(mailbox.clone(), None, Vec::new(), 1)
        .await
        .expect("sync");
    let mut appended = Vec::new();
    for _ in 0..3 {
        let raw = build_message(common::draft("bob", "alice", &common::unique("gap"), "x"))
            .expect("build");
        let uid = alice
            .append(mailbox.clone(), raw, Flags::default())
            .await
            .expect("append")
            .expect("UIDPLUS");
        appended.push(uid);
    }

    let delta = alice
        .sync(mailbox, Some(before.state), known(&before.changed), 2)
        .await
        .expect("delta sync");
    assert!(delta.truncated);
    let uids: Vec<u32> = delta.changed.iter().map(|message| message.uid).collect();
    assert_eq!(uids, [appended[2], appended[1]]);
}

#[tokio::test]
async fn a_changed_uid_validity_resets_the_mailbox() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let mut state = alice
        .sync("INBOX".into(), None, Vec::new(), 1)
        .await
        .expect("sync")
        .state;
    state.uid_validity = state.uid_validity.wrapping_add(1);

    let result = alice
        .sync("INBOX".into(), Some(state), Vec::new(), 1)
        .await
        .expect("sync");
    assert!(result.reset);
}

#[tokio::test]
async fn fetch_older_pages_back_from_the_oldest_synced_uid() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    for _ in 0..4 {
        let raw = build_message(common::draft("bob", "alice", &common::unique("page"), "x"))
            .expect("build");
        alice
            .append("Drafts".into(), raw, Flags::default())
            .await
            .expect("append");
    }

    let synced = alice
        .sync("Drafts".into(), None, Vec::new(), 2)
        .await
        .expect("sync");
    let newest = synced.changed;
    assert_eq!(newest.len(), 2);
    let oldest_synced = newest[1].uid;

    let older = alice
        .fetch_older("Drafts".into(), synced.state.uid_validity, oldest_synced, 2)
        .await
        .expect("older");
    assert_eq!(older.len(), 2);
    assert!(older[0].uid < oldest_synced);
    assert!(older[1].uid < older[0].uid);
    let none = alice
        .fetch_older("Drafts".into(), synced.state.uid_validity, 1, 2)
        .await
        .expect("none older");
    assert_eq!(none, []);
}
