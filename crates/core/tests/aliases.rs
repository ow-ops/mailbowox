mod common;

use mailbowox_core::{Address, send_message};

#[tokio::test]
async fn mail_alice_sends_from_her_alias_reaches_bob_from_the_alias() {
    let Some(()) = common::local_server() else {
        return;
    };
    let subject = common::unique("from the alias");
    let mut draft = common::draft("alice", "bob", &subject, "Sent from hello.");
    draft.from = Address {
        name: Some("Hello".to_owned()),
        email: "hello@mailbowox.test".to_owned(),
    };

    send_message(common::account("alice"), draft)
        .await
        .expect("alice sends from her alias");

    let bob = common::connect("bob").await;
    let message = common::wait_for_subject(&bob, "INBOX", &subject).await;
    assert_eq!(message.from.len(), 1);
    assert_eq!(message.from[0].email, "hello@mailbowox.test");
    assert_eq!(message.from[0].name.as_deref(), Some("Hello"));
}

#[tokio::test]
async fn mail_to_alices_alias_lands_in_her_inbox() {
    let Some(()) = common::local_server() else {
        return;
    };
    let subject = common::unique("to the alias");
    let mut draft = common::draft("bob", "alice", &subject, "Hello alias.");
    draft.to[0].email = "hello@mailbowox.test".to_owned();

    send_message(common::account("bob"), draft)
        .await
        .expect("bob writes to the alias");

    let alice = common::connect("alice").await;
    let message = common::wait_for_subject(&alice, "INBOX", &subject).await;
    assert_eq!(message.to[0].email, "hello@mailbowox.test");
}
