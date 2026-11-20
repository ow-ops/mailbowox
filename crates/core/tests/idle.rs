mod common;

use std::time::Duration;

use mailbowox_core::CoreError;

#[tokio::test]
async fn wait_for_changes_wakes_when_new_mail_arrives() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    alice
        .sync("INBOX".into(), None, Vec::new(), 1)
        .await
        .expect("sync");

    let waiting = tokio::spawn({
        let alice = alice.clone();
        async move { alice.wait_for_changes("INBOX".into(), 30).await }
    });
    tokio::time::sleep(Duration::from_millis(500)).await;
    common::bob_sends_alice(&common::unique("wake up"), "ping").await;

    let changed = tokio::time::timeout(Duration::from_secs(20), waiting)
        .await
        .expect("woke before the timeout")
        .expect("task")
        .expect("wait for changes");
    assert!(changed);

    alice
        .sync("INBOX".into(), None, Vec::new(), 1)
        .await
        .expect("the session stays usable");
}

#[tokio::test]
async fn wait_for_changes_times_out_quietly() {
    let Some(()) = common::local_server() else {
        return;
    };
    let bob = common::connect("bob").await;
    bob.sync("Drafts".into(), None, Vec::new(), 1)
        .await
        .expect("sync");

    let changed = bob
        .wait_for_changes("Drafts".into(), 2)
        .await
        .expect("wait");
    assert!(!changed);
}

#[tokio::test]
async fn a_call_dropped_midway_ends_the_session() {
    let Some(()) = common::local_server() else {
        return;
    };
    let bob = common::connect("bob").await;
    let waiting = tokio::spawn({
        let bob = bob.clone();
        async move { bob.wait_for_changes("Drafts".into(), 30).await }
    });
    tokio::time::sleep(Duration::from_millis(500)).await;
    // The server is left idling, so the connection can't carry another command.
    waiting.abort();
    let _ = waiting.await;

    let next = bob.list_mailboxes().await;
    assert!(matches!(next, Err(CoreError::Network { .. })), "{next:?}");
    bob.logout().await.expect("logout");
}
