//! Properties of the parsers that read data from other people: whatever the
//! bytes, they return instead of panicking, and what they return holds up.

use proptest::prelude::*;

use crate::{
    parsers::{
        attachment, autoconfig, contact, message_body, mx, sanitize_html, srv, summary,
        update_contact,
    },
    types::{Address, ContactDraft, ContactValue, Draft, OutgoingAttachment},
};

proptest! {
    #[test]
    fn any_bytes_are_a_message_or_an_error(raw in prop::collection::vec(any::<u8>(), 0..2048)) {
        if let Ok(body) = message_body(1, &raw, false) {
            for info in &body.attachments {
                prop_assert!(attachment(&raw, info.index).is_ok());
            }
        }
        let (header, text) = raw.split_at(raw.len() / 2);
        let _ = summary(header, text);
    }

    #[test]
    fn a_built_message_gives_back_its_text_and_attachments(
        text in "[a-zA-Z0-9.,!?é]{1,20}( [a-zA-Z0-9.,!?é]{1,20}){0,8}",
        name in "[a-z]{1,12}\\.[a-z]{2,3}",
        data in prop::collection::vec(any::<u8>(), 0..512),
    ) {
        let raw = crate::build_message(Draft {
            from: Address { name: None, email: "me@example.org".into() },
            to: vec![Address { name: None, email: "you@example.org".into() }],
            cc: Vec::new(),
            bcc: Vec::new(),
            subject: "s".into(),
            text: text.clone(),
            html: None,
            in_reply_to: None,
            references: Vec::new(),
            attachments: vec![OutgoingAttachment {
                filename: name.clone(),
                mime_type: "application/octet-stream".into(),
                data: data.clone(),
            }],
        }).unwrap();

        let body = message_body(1, &raw, false).unwrap();
        prop_assert_eq!(body.text.as_deref().map(str::trim_end), Some(text.as_str()));
        prop_assert_eq!(body.attachments.len(), 1);
        prop_assert_eq!(body.attachments[0].filename.as_deref(), Some(name.as_str()));
        prop_assert_eq!(attachment(&raw, body.attachments[0].index).unwrap(), data);
    }

    #[test]
    fn sanitised_html_has_no_active_content(
        html in prop_oneof![
            any::<String>(),
            prop::collection::vec(
                "<[a-z]{1,8}( [a-z-]{1,8}=\"[a-z:/.()0-9 ,]{0,20}\"){0,3}>|</[a-z]{1,8}>|<script>|<iframe src=x>|[a-z ]{0,8}",
                0..12,
            ).prop_map(|parts| parts.concat()),
        ],
        allow_remote in any::<bool>(),
    ) {
        let out = sanitize_html(&html, allow_remote).html.to_ascii_lowercase();
        prop_assert!(!out.contains("<script"));
        prop_assert!(!out.contains("<iframe"));
        prop_assert!(!out.contains("<style"));
    }

    #[test]
    fn remote_images_never_survive_when_blocked(url in "(https?:)?//[a-z]{1,10}\\.[a-z]{2,3}/[a-z]{0,10}") {
        let out = sanitize_html(&format!("<img src=\"{url}\">"), false);
        prop_assert!(out.has_remote_content);
        prop_assert_eq!(out.blocked_remote, 1);
        prop_assert!(!out.html.contains("//"));
    }

    #[test]
    fn any_text_is_a_contact_or_nothing(vcard in "\\PC{0,512}") {
        let draft = contact_draft("Jane", "jane@example.org");
        let _ = contact("/c.vcf".into(), None, vcard.clone());
        let _ = update_contact(&vcard, &draft);
    }

    #[test]
    fn a_written_contact_reads_back_as_drafted(
        name in "[\\p{L}][\\p{L} .'-]{0,30}[\\p{L}]",
        email in "[a-z0-9.+_-]{1,12}@[a-z]{1,10}\\.[a-z]{2,3}",
    ) {
        let draft = contact_draft(&name, &email);
        let card = crate::vcard::new_contact("uid-1", &draft);
        let read = contact("/c.vcf".into(), None, card).unwrap();
        prop_assert_eq!(read.name, name);
        prop_assert_eq!(read.emails, draft.emails);
    }

    #[test]
    fn any_server_reply_is_settings_or_nothing(response in prop::collection::vec(any::<u8>(), 0..1024)) {
        let _ = autoconfig(&response);
        let _ = srv(&response);
        let _ = mx(&response);
    }
}

fn contact_draft(name: &str, email: &str) -> ContactDraft {
    ContactDraft {
        name: name.into(),
        given: None,
        family: None,
        emails: vec![ContactValue {
            value: email.into(),
            kind: Some("work".into()),
        }],
        phones: Vec::new(),
        organization: None,
    }
}
