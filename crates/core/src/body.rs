use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::STANDARD};
use mail_parser::{MessageParser, MessagePart, MessageRef, PartKind};

use crate::{
    error::CoreError,
    sanitize::sanitize_html_with,
    types::{AttachmentInfo, MessageBody},
};

pub(crate) fn message_body(
    uid: u32,
    raw: &[u8],
    allow_remote: bool,
) -> Result<MessageBody, CoreError> {
    let message = MessageParser::new()
        .parse(raw)
        .ok_or_else(|| CoreError::protocol("the message could not be parsed"))?;
    let root = message.root();

    let html = root
        .html_body()
        .find(|part| matches!(part.kind(), PartKind::Html))
        .and_then(|part| part.text())
        .map(|html| sanitize_html_with(&html, allow_remote, inline_images(&message)));

    Ok(MessageBody {
        uid,
        text: root.body_text(0).map(Into::into),
        has_remote_content: html.as_ref().is_some_and(|html| html.has_remote_content),
        blocked_remote: html.as_ref().map_or(0, |html| html.blocked_remote),
        html: html.map(|html| html.html),
        attachments: attachments(root),
        list_unsubscribe: root.headers().list_unsubscribe().map_or_default(|urls| {
            urls.mailboxes()
                .filter_map(|url| url.address().map(Into::into))
                .collect()
        }),
        list_unsubscribe_one_click: root
            .headers()
            .get("List-Unsubscribe-Post")
            .and_then(|header| header.value().as_text())
            .is_some_and(|value| {
                value
                    .trim()
                    .eq_ignore_ascii_case("List-Unsubscribe=One-Click")
            }),
    })
}

pub(crate) fn attachment(raw: &[u8], index: u32) -> Result<Vec<u8>, CoreError> {
    let message = MessageParser::new()
        .parse(raw)
        .ok_or_else(|| CoreError::protocol("the message could not be parsed"))?;
    let part = message
        .part(index)
        .ok_or_else(|| CoreError::not_found(format!("no part {index}")))?;
    Ok(part.decoded().into_owned())
}

/// The images a body can show by `cid:`, as `data:` URLs by Content-ID. The reader has no
/// other way to reach a part of the message.
fn inline_images(message: &mail_parser::Message<'_>) -> HashMap<String, String> {
    message
        .parts()
        .filter_map(|part| {
            let info = info(&part);
            let id = info
                .content_id
                .filter(|_| info.mime_type.starts_with("image/"))?;
            let data = STANDARD.encode(part.decoded());
            Some((id, format!("data:{};base64,{data}", info.mime_type)))
        })
        .collect()
}

/// The downloadable parts plus the images an HTML body shows inline.
fn attachments(root: MessageRef<'_>) -> Vec<AttachmentInfo> {
    let inline_media = root
        .html_body()
        .filter(|part| !matches!(part.kind(), PartKind::Html | PartKind::Text));

    let mut infos: Vec<AttachmentInfo> = Vec::new();
    for part in root.attachments().chain(inline_media) {
        if infos.iter().all(|info| info.index != part.id()) {
            infos.push(info(&part));
        }
    }
    infos
}

fn info(part: &MessagePart<'_>) -> AttachmentInfo {
    let mime_type = part.content_type().map_or_else(
        || "application/octet-stream".to_owned(),
        |ct| {
            ct.subtype().map_or_else(
                || ct.ctype().to_owned(),
                |subtype| format!("{}/{subtype}", ct.ctype()),
            )
        },
    );
    AttachmentInfo {
        index: part.id(),
        filename: part.attachment_name().map(str::to_owned),
        mime_type: mime_type.to_ascii_lowercase(),
        size: u32::try_from(part.decoded_len()).unwrap_or(u32::MAX),
        content_id: part
            .content_id()
            .map(|id| id.trim_matches(['<', '>']).to_owned()),
        inline: part.is_inline(),
        section: section(part),
    }
}

/// The part's number in each multipart on the way down to it (RFC 3501 6.4.5).
fn section(part: &MessagePart<'_>) -> Option<String> {
    if part.message().id() != 0 {
        return None;
    }
    let mut numbers = Vec::new();
    let mut current = *part;
    while let Some(parent) = current.parent() {
        let position = parent
            .children()
            .position(|child| child.id() == current.id())?;
        numbers.push((position + 1).to_string());
        current = parent;
    }
    numbers.reverse();
    (!numbers.is_empty()).then(|| numbers.join("."))
}

/// The content of a part fetched alone, from its MIME header and its body as
/// the server sent them. `None` when it is not the part `expected` describes:
/// the server and the parser may number a malformed message differently.
pub(crate) fn lone_part(
    mime_header: &[u8],
    body: &[u8],
    expected: &AttachmentInfo,
) -> Option<Vec<u8>> {
    let raw = [mime_header, body].concat();
    let message = MessageParser::new().parse(&raw)?;
    let part = message.root().root_part();
    let found = info(&part);
    let same = found.filename == expected.filename
        && found.mime_type == expected.mime_type
        && found.content_id == expected.content_id
        && found.size == expected.size;
    same.then(|| part.decoded().into_owned())
}

#[cfg(test)]
mod tests {
    use super::message_body;

    #[test]
    fn a_part_is_numbered_through_each_multipart_down_to_it() {
        let raw = concat!(
            "Subject: nested\r\n",
            "Content-Type: multipart/mixed; boundary=a\r\n\r\n",
            "--a\r\nContent-Type: multipart/related; boundary=b\r\n\r\n",
            "--b\r\nContent-Type: text/html\r\n\r\n<img src=\"cid:logo\">\r\n",
            "--b\r\nContent-Type: image/png\r\nContent-ID: <logo>\r\n\r\nPNG\r\n",
            "--b--\r\n",
            "--a\r\nContent-Type: application/pdf; name=report.pdf\r\n",
            "Content-Disposition: attachment; filename=report.pdf\r\n\r\nPDF\r\n",
            "--a--\r\n",
        );
        let body = message_body(1, raw.as_bytes(), false).expect("a body");
        let section = |mime_type: &str| {
            body.attachments
                .iter()
                .find(|attachment| attachment.mime_type == mime_type)
                .and_then(|attachment| attachment.section.clone())
        };
        assert_eq!(section("image/png").as_deref(), Some("1.2"));
        assert_eq!(section("application/pdf").as_deref(), Some("2"));

        let alone = message_body(
            1,
            b"Subject: x\r\nContent-Type: application/pdf\r\n\r\nPDF",
            false,
        )
        .expect("a body");
        assert!(
            alone
                .attachments
                .iter()
                .all(|attachment| attachment.section.is_none())
        );
    }

    #[test]
    fn an_inline_image_is_shown_from_the_message_itself() {
        let raw = concat!(
            "Subject: logo\r\n",
            "Content-Type: multipart/related; boundary=b\r\n\r\n",
            "--b\r\nContent-Type: text/html\r\n\r\n",
            "<p>hi</p><img src=\"cid:logo@example\">\r\n",
            "--b\r\nContent-Type: image/png\r\nContent-ID: <logo@example>\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\niVBORw==\r\n",
            "--b--\r\n",
        );
        let body = message_body(1, raw.as_bytes(), false).expect("a body");
        let html = body.html.expect("html");
        assert!(
            html.contains(r#"src="data:image/png;base64,iVBORw==""#),
            "{html}"
        );
        assert_eq!(body.blocked_remote, 0);
    }

    #[test]
    fn a_list_offering_one_click_unsubscription_says_so() {
        let raw = concat!(
            "Subject: news\r\n",
            "List-Unsubscribe: <mailto:leave@list.example?subject=stop>, <https://list.example/u?id=1>\r\n",
            "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            "Content-Type: text/plain\r\n\r\nhi\r\n",
        );
        let body = message_body(1, raw.as_bytes(), false).expect("a body");
        assert_eq!(
            body.list_unsubscribe,
            [
                "mailto:leave@list.example?subject=stop",
                "https://list.example/u?id=1"
            ]
        );
        assert!(body.list_unsubscribe_one_click);

        let plain = message_body(
            1,
            b"Subject: x\r\nList-Unsubscribe: <https://list.example/u>\r\n\r\nhi",
            false,
        )
        .expect("a body");
        assert!(!plain.list_unsubscribe_one_click);
    }
}
