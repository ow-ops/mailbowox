mod common;

#[tokio::test]
async fn mail_bob_sends_shows_up_in_alices_sync() {
    let Some(()) = common::local_server() else {
        return;
    };
    let subject = common::unique("hello alice");
    let raw = common::bob_sends_alice(&subject, "Lunch at noon? The usual place.").await;
    assert!(String::from_utf8_lossy(&raw).contains("Message-ID: <"));

    let alice = common::connect("alice").await;
    let message = common::wait_for_subject(&alice, "INBOX", &subject).await;

    assert_eq!(message.from.len(), 1);
    assert_eq!(message.from[0].email, "bob@mailbowox.test");
    assert_eq!(message.from[0].name.as_deref(), Some("bob"));
    assert_eq!(message.to[0].email, "alice@mailbowox.test");
    assert_eq!(message.preview, "Lunch at noon? The usual place.");
    assert!(message.message_id.is_some());
    assert!(!message.flags.seen);
    assert!(!message.has_attachments);
    assert!(message.size > 0);
    assert!(message.date > 1_700_000_000);
}
