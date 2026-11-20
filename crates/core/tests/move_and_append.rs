mod common;

use mailbowox_core::{CoreError, Flags, KnownMessage, MailboxRole, build_message};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

#[tokio::test]
async fn move_messages_lands_them_in_the_archive() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let mailboxes = alice.list_mailboxes().await.expect("list");
    let archive = mailboxes
        .iter()
        .find(|m| m.role == Some(MailboxRole::Archive));
    let archive = if let Some(archive) = archive {
        archive.name.clone()
    } else {
        alice
            .create_mailbox("Archive".into())
            .await
            .expect("create");
        "Archive".to_owned()
    };

    let subject = common::unique("to archive");
    let raw = build_message(common::draft("bob", "alice", &subject, "x")).expect("build");
    let uid = alice
        .append("INBOX".into(), raw, Flags::default())
        .await
        .expect("append")
        .expect("UIDPLUS");
    let before = alice
        .sync("INBOX".into(), None, Vec::new(), 1)
        .await
        .expect("sync")
        .state;

    let archived = alice
        .move_messages(
            "INBOX".into(),
            before.uid_validity,
            vec![uid],
            archive.clone(),
        )
        .await
        .expect("move")
        .expect("COPYUID");

    let moved = common::wait_for_subject(&alice, &archive, &subject).await;
    assert_eq!(moved.subject, subject);
    assert_eq!(archived.uids, [moved.uid]);
    let inbox = alice
        .sync(
            "INBOX".into(),
            Some(before),
            vec![KnownMessage {
                uid,
                flags: Flags::default(),
            }],
            10,
        )
        .await
        .expect("sync");
    assert!(inbox.vanished.contains(&uid));

    let restored = alice
        .move_messages(
            archive,
            archived.uid_validity,
            archived.uids,
            "INBOX".into(),
        )
        .await
        .expect("move back")
        .expect("COPYUID");
    let back = common::wait_for_subject(&alice, "INBOX", &subject).await;
    assert_eq!(restored.uids, [back.uid]);
    assert_eq!(restored.uid_validity, before.uid_validity);
}

#[tokio::test]
async fn sent_copies_are_appended_with_their_uid() {
    let Some(()) = common::local_server() else {
        return;
    };
    let subject = common::unique("sent copy");
    let raw = build_message(common::draft(
        "bob",
        "alice",
        &subject,
        "kept for the record",
    ))
    .expect("build");

    let bob = common::connect("bob").await;
    let sent = bob
        .list_mailboxes()
        .await
        .expect("list")
        .into_iter()
        .find(|m| m.role == Some(MailboxRole::Sent))
        .expect("a Sent mailbox")
        .name;
    let seen = Flags {
        seen: true,
        ..Flags::default()
    };
    let uid = bob.append(sent.clone(), raw, seen).await.expect("append");

    let copy = common::wait_for_subject(&bob, &sent, &subject).await;
    assert_eq!(Some(copy.uid), uid);
    assert!(copy.flags.seen);
    assert_eq!(copy.preview, "kept for the record");
}

#[tokio::test]
async fn stale_uids_cannot_change_mail_and_expunge_only_removes_the_requested_uid() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let inbox = "INBOX".to_owned();
    let subject = common::unique("expunge target");
    let target = alice
        .append(
            inbox.clone(),
            build_message(common::draft("bob", "alice", &subject, "x")).unwrap(),
            Flags::default(),
        )
        .await
        .unwrap()
        .unwrap();
    let other = alice
        .append(
            inbox.clone(),
            build_message(common::draft(
                "bob",
                "alice",
                &common::unique("unrelated"),
                "x",
            ))
            .unwrap(),
            Flags {
                deleted: true,
                ..Flags::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    let generation = common::uid_validity(&alice, &inbox).await;
    let stale = generation.wrapping_add(1);
    let seen = Flags {
        seen: true,
        ..Flags::default()
    };
    assert!(matches!(
        alice
            .set_flags(inbox.clone(), stale, vec![target], seen, Flags::default())
            .await,
        Err(CoreError::NotFound { .. })
    ));
    assert!(matches!(
        alice
            .move_messages(inbox.clone(), stale, vec![target], "Drafts".into())
            .await,
        Err(CoreError::NotFound { .. })
    ));
    assert!(matches!(
        alice
            .delete_messages(inbox.clone(), stale, vec![target])
            .await,
        Err(CoreError::NotFound { .. })
    ));
    let summaries = alice
        .fetch_summaries(inbox.clone(), generation, vec![target])
        .await
        .unwrap();
    assert_eq!(summaries[0].subject, subject);
    assert!(!summaries[0].flags.seen);

    alice
        .delete_messages(inbox.clone(), generation, vec![target])
        .await
        .unwrap();
    let remaining = alice
        .fetch_summaries(inbox.clone(), generation, vec![target, other])
        .await
        .unwrap();
    assert_eq!(
        remaining
            .iter()
            .map(|message| message.uid)
            .collect::<Vec<_>>(),
        [other]
    );
    alice
        .delete_messages(inbox, generation, vec![other])
        .await
        .unwrap();
}

#[tokio::test]
async fn a_server_without_uidplus_or_move_gets_no_mutating_commands() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        write
            .write_all(b"* PREAUTH [CAPABILITY IMAP4rev1] ready\r\n")
            .await
            .unwrap();
        let mut lines = BufReader::new(read).lines();
        while let Some(line) = lines.next_line().await.unwrap() {
            let (tag, command) = line.split_once(' ').unwrap();
            let response = match command.split_whitespace().next().unwrap() {
                "CAPABILITY" => "* CAPABILITY IMAP4rev1\r\n",
                "SELECT" => {
                    "* 2 EXISTS\r\n* OK [UIDVALIDITY 7] current\r\n* OK [UIDNEXT 3] next\r\n"
                }
                _ => panic!("unexpected IMAP command: {command}"),
            };
            write
                .write_all(format!("{response}{tag} OK done\r\n").as_bytes())
                .await
                .unwrap();
        }
    });
    let mut config = common::account("alice");
    config.imap.host = "127.0.0.1".into();
    config.imap.port = port;
    let session = mailbowox_core::MailSession::connect(config).await.unwrap();

    let delete = session.delete_messages("INBOX".into(), 7, vec![1]).await;
    let moved = session
        .move_messages("INBOX".into(), 7, vec![1], "Archive".into())
        .await;
    assert!(
        matches!(delete, Err(CoreError::Invalid { .. })),
        "{delete:?}"
    );
    assert!(matches!(moved, Err(CoreError::Invalid { .. })), "{moved:?}");
    drop(session);
    server.await.unwrap();
}
