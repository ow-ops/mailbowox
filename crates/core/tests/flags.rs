mod common;

use mailbowox_core::{Flags, build_message};

#[tokio::test]
async fn set_flags_adds_and_removes_only_the_named_flags() {
    let Some(()) = common::local_server() else {
        return;
    };
    let subject = common::unique("flags");
    let raw = build_message(common::draft("bob", "alice", &subject, "x")).expect("build");
    let alice = common::connect("alice").await;
    let seen = Flags {
        seen: true,
        ..Flags::default()
    };
    let uid = alice
        .append("INBOX".into(), raw, seen)
        .await
        .expect("append")
        .expect("UIDPLUS");

    let add = Flags {
        flagged: true,
        answered: true,
        ..Flags::default()
    };
    let uid_validity = common::uid_validity(&alice, "INBOX").await;
    alice
        .set_flags("INBOX".into(), uid_validity, vec![uid], add, seen)
        .await
        .expect("set flags");

    let flags = common::wait_for_subject(&alice, "INBOX", &subject)
        .await
        .flags;
    assert_eq!(
        flags,
        Flags {
            flagged: true,
            answered: true,
            ..Flags::default()
        }
    );
}
