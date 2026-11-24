//! Message summaries built from one FETCH: flags, size, structure, a few
//! header fields and the first bytes of the body, never the whole message.

use std::num::NonZeroU32;

use io_imap::types::{
    body::{BodyStructure, SpecificFields},
    core::{AString, NString, Vec1},
    fetch::{MacroOrMessageDataItemNames, MessageDataItem, MessageDataItemName, Section},
    flag::{Flag, FlagFetch},
};
use mail_parser::{AddressList, HeaderName, MessageParser, MessageRef};

use crate::types::{Address, Flags, MessageSummary};

const PREVIEW_CHARS: usize = 200;
const PREVIEW_BYTES: u32 = 2048;
const HEADER_FIELDS: [&str; 12] = [
    "DATE",
    "SUBJECT",
    "FROM",
    "TO",
    "CC",
    "REPLY-TO",
    "DELIVERED-TO",
    "MESSAGE-ID",
    "IN-REPLY-TO",
    "REFERENCES",
    "CONTENT-TYPE",
    "CONTENT-TRANSFER-ENCODING",
];

#[expect(
    clippy::expect_used,
    reason = "the header names are atoms and the preview length is non-zero"
)]
pub(crate) fn summary_items() -> MacroOrMessageDataItemNames<'static> {
    let fields = HEADER_FIELDS
        .iter()
        .map(|&field| AString::try_from(field).expect("header names are atoms"))
        .collect::<Vec<_>>();
    let fields = Vec1::try_from(fields).expect("the field list is not empty");

    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
        MessageDataItemName::Uid,
        MessageDataItemName::Flags,
        MessageDataItemName::Rfc822Size,
        MessageDataItemName::InternalDate,
        MessageDataItemName::BodyStructure,
        MessageDataItemName::BodyExt {
            section: Some(Section::HeaderFields(None, fields)),
            partial: None,
            peek: true,
        },
        MessageDataItemName::BodyExt {
            section: Some(Section::Text(None)),
            partial: Some((0, NonZeroU32::new(PREVIEW_BYTES).expect("non-zero"))),
            peek: true,
        },
    ])
}

pub(crate) fn uid_flags_items() -> MacroOrMessageDataItemNames<'static> {
    MacroOrMessageDataItemNames::MessageDataItemNames(vec![
        MessageDataItemName::Uid,
        MessageDataItemName::Flags,
    ])
}

pub(crate) fn uid_of(items: &[MessageDataItem<'_>]) -> Option<u32> {
    items.iter().find_map(|item| match item {
        MessageDataItem::Uid(uid) => Some(uid.get()),
        _ => None,
    })
}

pub(crate) fn flags_of(items: &[MessageDataItem<'_>]) -> Option<Flags> {
    items.iter().find_map(|item| match item {
        MessageDataItem::Flags(flags) => Some(Flags::from_fetch(flags)),
        _ => None,
    })
}

pub(crate) fn summary(items: &[MessageDataItem<'_>]) -> Option<MessageSummary> {
    let mut header: &[u8] = &[];
    let mut text: &[u8] = &[];
    let mut internal_date = 0;
    let mut size = 0;
    let mut has_attachments = false;

    for item in items {
        match item {
            MessageDataItem::Rfc822Size(n) => size = *n,
            MessageDataItem::InternalDate(date) => internal_date = date.as_ref().timestamp(),
            MessageDataItem::BodyStructure(body) | MessageDataItem::Body(body) => {
                has_attachments = structure_has_attachments(body);
            }
            MessageDataItem::BodyExt {
                section: Some(Section::HeaderFields(..)),
                data,
                ..
            } => {
                header = bytes(data);
            }
            MessageDataItem::BodyExt {
                section: Some(Section::Text(None)),
                data,
                ..
            } => {
                text = bytes(data);
            }
            _ => {}
        }
    }

    let raw = [header, text].concat();
    let message = MessageParser::new().parse(&raw);
    let message = message.as_ref().map(mail_parser::Message::root);

    Some(MessageSummary {
        uid: uid_of(items)?,
        flags: flags_of(items).unwrap_or_default(),
        subject: message
            .and_then(|m| m.subject())
            .unwrap_or_default()
            .to_owned(),
        from: addresses(message.and_then(|m| m.from())),
        to: addresses(message.and_then(|m| m.to())),
        cc: addresses(message.and_then(|m| m.cc())),
        reply_to: addresses(message.and_then(|m| m.reply_to())),
        delivered_to: message.map_or_default(delivered_to),
        date: message
            .and_then(|m| m.date())
            .map_or(internal_date, |date| date.to_timestamp()),
        message_id: message.and_then(|m| m.message_id()).map(str::to_owned),
        in_reply_to: message
            .and_then(|m| m.in_reply_to())
            .and_then(|ids| ids.first())
            .map(str::to_owned),
        references: message
            .and_then(|m| m.references())
            .map_or_default(|ids| ids.iter().map(str::to_owned).collect()),
        preview: message.map_or_default(preview),
        has_attachments,
        size,
    })
}

// Replies quote what they answer, so the quoted lines and the "On ..., Alice wrote:" line above
// them are dropped; the rest runs on one line, as the list shows it.
fn preview(message: MessageRef<'_>) -> String {
    let Some(text) = message.body_preview(PREVIEW_BYTES as usize) else {
        return String::new();
    };
    let mut kept: Vec<&str> = Vec::new();
    let mut quoting = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('>') {
            if !quoting && kept.last().is_some_and(|last| last.ends_with(':')) {
                kept.pop();
            }
            quoting = true;
        } else if !line.is_empty() {
            quoting = false;
            kept.push(line);
        }
    }
    kept.iter()
        .flat_map(|line| line.split_whitespace())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(PREVIEW_CHARS)
        .collect()
}

fn delivered_to(message: MessageRef<'_>) -> Vec<String> {
    message
        .headers()
        .all(HeaderName::DeliveredTo)
        .filter_map(|header| Some(header.value().as_text()?.trim().to_owned()))
        .collect()
}

fn addresses(list: Option<AddressList<'_>>) -> Vec<Address> {
    let Some(list) = list else {
        return Vec::new();
    };
    list.mailboxes()
        .filter_map(|mailbox| {
            Some(Address {
                name: mailbox.name().map(str::to_owned),
                email: mailbox.address()?.to_owned(),
            })
        })
        .collect()
}

fn bytes<'a>(data: &'a NString<'_>) -> &'a [u8] {
    data.0.as_ref().map_or(&[], AsRef::as_ref)
}

/// A part counts as an attachment when it says so, or when it is neither
/// text nor an inline image referenced by Content-ID.
fn structure_has_attachments(body: &BodyStructure<'_>) -> bool {
    match body {
        BodyStructure::Multi { bodies, .. } => {
            bodies.as_ref().iter().any(structure_has_attachments)
        }
        BodyStructure::Single {
            body,
            extension_data,
        } => {
            let disposition = extension_data
                .as_ref()
                .and_then(|data| data.tail.as_ref())
                .and_then(|tail| tail.disposition.as_ref())
                .map(|(kind, _)| kind.as_ref().to_ascii_lowercase());
            match disposition.as_deref() {
                Some(b"attachment") => true,
                Some(b"inline") => false,
                _ => match body.specific {
                    SpecificFields::Text { .. } => false,
                    SpecificFields::Basic { .. } | SpecificFields::Message { .. } => {
                        body.basic.id.0.is_none()
                    }
                },
            }
        }
    }
}

impl Flags {
    fn from_fetch(flags: &[FlagFetch<'_>]) -> Self {
        let mut out = Self::default();
        for flag in flags {
            match flag {
                FlagFetch::Flag(Flag::Seen) => out.seen = true,
                FlagFetch::Flag(Flag::Flagged) => out.flagged = true,
                FlagFetch::Flag(Flag::Answered) => out.answered = true,
                FlagFetch::Flag(Flag::Draft) => out.draft = true,
                FlagFetch::Flag(Flag::Deleted) => out.deleted = true,
                _ => {}
            }
        }
        out
    }

    pub(crate) fn to_imap(self) -> Vec<Flag<'static>> {
        [
            (self.seen, Flag::Seen),
            (self.flagged, Flag::Flagged),
            (self.answered, Flag::Answered),
            (self.draft, Flag::Draft),
            (self.deleted, Flag::Deleted),
        ]
        .into_iter()
        .filter_map(|(set, flag)| set.then_some(flag))
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview_of(raw: &[u8]) -> String {
        let message = MessageParser::new().parse(raw).unwrap();
        preview(message.root())
    }

    #[test]
    fn preview_drops_the_attribution_and_quoted_lines() {
        let raw = b"Subject: Re: x\r\n\r\nOn Wed, 19 Nov 2026 at 21:41, Alice <alice@example.com> wrote:\r\n> Is the boat ready?\r\n> \r\n\r\nYes, it is.\r\n";
        assert_eq!(preview_of(raw), "Yes, it is.");
    }

    #[test]
    fn preview_keeps_answers_between_quotes() {
        let raw =
            b"Subject: Re: x\r\n\r\nAlice wrote:\r\n> First?\r\nOne.\r\n> Second?\r\nTwo.\r\n";
        assert_eq!(preview_of(raw), "One. Two.");
    }

    #[test]
    fn preview_runs_lines_together_with_a_space() {
        let raw = b"Subject: x\r\n\r\nThe boat takes on water.\r\nCount the buckets:\r\n\r\n  three   of them\r\n";
        assert_eq!(
            preview_of(raw),
            "The boat takes on water. Count the buckets: three of them"
        );
    }

    #[test]
    fn preview_is_cut_to_its_length() {
        let raw = format!("Subject: x\r\n\r\n{}", "é".repeat(300));
        assert_eq!(preview_of(raw.as_bytes()).chars().count(), PREVIEW_CHARS);
    }

    #[test]
    fn delivered_to_lists_every_header() {
        let raw = b"Delivered-To: hello@example.com\r\nDelivered-To: Alice@Example.com\r\nSubject: x\r\n\r\nbody";
        let message = MessageParser::new().parse(raw);
        let root = message.as_ref().map(mail_parser::Message::root).unwrap();
        assert_eq!(
            delivered_to(root),
            ["hello@example.com", "Alice@Example.com"]
        );
    }
}
