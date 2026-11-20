mod common;

use mailbowox_core::MailboxRole;

#[tokio::test]
async fn connect_lists_mailboxes_with_their_roles() {
    let Some(()) = common::local_server() else {
        return;
    };
    let session = common::connect("alice").await;

    let mailboxes = session.list_mailboxes().await.expect("list");

    let role_of = |role| mailboxes.iter().find(|m| m.role == Some(role));
    let inbox = role_of(MailboxRole::Inbox).expect("an inbox");
    assert_eq!(inbox.name, "INBOX");
    assert!(inbox.selectable);
    assert!(role_of(MailboxRole::Sent).is_some());
    assert!(role_of(MailboxRole::Trash).is_some());

    session.logout().await.expect("logout");
}
