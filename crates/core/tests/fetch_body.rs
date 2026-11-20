mod common;

use mailbowox_core::{AttachmentInfo, Flags, OutgoingAttachment, build_message};

#[tokio::test]
async fn fetch_body_sanitises_html_and_lists_attachments() {
    let Some(()) = common::local_server() else {
        return;
    };
    let subject = common::unique("newsletter");
    let mut draft = common::draft("bob", "alice", &subject, "plain version");
    draft.html = Some(
        r#"<p onclick="x()">Hello</p><script>alert(1)</script><img src="https://tracker.test/p.gif">"#
            .into(),
    );
    draft.attachments.push(OutgoingAttachment {
        filename: "notes.txt".into(),
        mime_type: "text/plain".into(),
        data: b"attached bytes".to_vec(),
    });
    draft.attachments.push(OutgoingAttachment {
        filename: "other.txt".into(),
        mime_type: "text/plain".into(),
        data: b"another bytes!".to_vec(),
    });
    let raw = build_message(draft).expect("build");

    let alice = common::connect("alice").await;
    let uid = alice
        .append("INBOX".into(), raw, Flags::default())
        .await
        .expect("append")
        .expect("UIDPLUS");
    let uid_validity = common::uid_validity(&alice, "INBOX").await;

    let body = alice
        .fetch_body("INBOX".into(), uid_validity, uid, false)
        .await
        .expect("body");
    let html = body.html.expect("an html part");
    assert!(html.contains("Hello"));
    assert!(!html.contains("<script"));
    assert!(!html.contains("onclick"));
    assert!(!html.contains("tracker.test"));
    assert!(body.has_remote_content);
    assert_eq!(body.blocked_remote, 1);
    assert_eq!(body.text.as_deref().map(str::trim), Some("plain version"));

    let attachment = body
        .attachments
        .iter()
        .find(|a| a.filename.as_deref() == Some("notes.txt"))
        .expect("the attachment");
    assert_eq!(attachment.mime_type, "text/plain");
    // The message is mixed(alternative(text, html), notes, other).
    assert_eq!(attachment.section.as_deref(), Some("2"));
    let bytes = alice
        .fetch_attachment("INBOX".into(), uid_validity, uid, attachment.clone())
        .await
        .expect("attachment");
    assert_eq!(bytes, b"attached bytes");

    // Only that part is downloaded: with an index that names another part, the section still finds it.
    let by_section = AttachmentInfo {
        index: 0,
        ..attachment.clone()
    };
    let bytes = alice
        .fetch_attachment("INBOX".into(), uid_validity, uid, by_section)
        .await
        .expect("attachment by its section");
    assert_eq!(bytes, b"attached bytes");

    // A section that holds another part, here one of the same size and type, is not taken for it.
    let misplaced = AttachmentInfo {
        section: Some("3".into()),
        ..attachment.clone()
    };
    let bytes = alice
        .fetch_attachment("INBOX".into(), uid_validity, uid, misplaced)
        .await
        .expect("attachment from the whole message");
    assert_eq!(bytes, b"attached bytes");

    let summary = common::wait_for_subject(&alice, "INBOX", &subject).await;
    assert!(summary.flags.seen, "fetching the body marks it seen");
    assert!(summary.has_attachments);

    let allowed = alice
        .fetch_body("INBOX".into(), uid_validity, uid, true)
        .await
        .expect("body");
    assert!(
        allowed
            .html
            .expect("html")
            .contains("https://tracker.test/p.gif")
    );
}

#[tokio::test]
async fn fetching_a_missing_uid_is_not_found() {
    let Some(()) = common::local_server() else {
        return;
    };
    let alice = common::connect("alice").await;
    let uid_validity = common::uid_validity(&alice, "INBOX").await;
    let err = alice
        .fetch_body("INBOX".into(), uid_validity, u32::MAX - 1, false)
        .await
        .expect_err("no such message");
    assert!(
        matches!(err, mailbowox_core::CoreError::NotFound { .. }),
        "{err:?}"
    );
}
