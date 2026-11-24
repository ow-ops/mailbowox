use mail_builder::{MessageBuilder, headers::address::Address as MimeAddress};

use crate::{
    error::CoreError,
    types::{Address, Draft},
};

pub(crate) fn build(draft: &Draft) -> Result<Vec<u8>, CoreError> {
    let domain = draft
        .from
        .email
        .rsplit_once('@')
        .map(|(_, domain)| domain)
        .ok_or_else(|| CoreError::invalid("the sender address has no domain"))?;
    // A random id, so the device's host name never leaks into headers.
    let message_id = format!("{}@{domain}", uuid::Uuid::new_v4());

    let mut builder = MessageBuilder::new()
        .message_id(message_id)
        .from(mime_address(&draft.from))
        .subject(draft.subject.as_str())
        .text_body(draft.text.as_str());

    if !draft.to.is_empty() {
        builder = builder.to(mime_addresses(&draft.to));
    }
    if !draft.cc.is_empty() {
        builder = builder.cc(mime_addresses(&draft.cc));
    }
    if !draft.bcc.is_empty() {
        builder = builder.bcc(mime_addresses(&draft.bcc));
    }
    if let Some(html) = &draft.html {
        builder = builder.html_body(html.as_str());
    }
    if let Some(parent) = &draft.in_reply_to {
        builder = builder.in_reply_to(parent.as_str());
    }
    if !draft.references.is_empty() {
        builder = builder.references(draft.references.clone());
    }
    for attachment in &draft.attachments {
        builder = builder.attachment(
            attachment.mime_type.as_str(),
            attachment.filename.as_str(),
            attachment.data.as_slice(),
        );
    }

    builder.write_to_vec().map_err(CoreError::protocol)
}

fn mime_address(address: &Address) -> MimeAddress<'_> {
    address.name.as_ref().map_or_else(
        || address.email.as_str().into(),
        |name| (name.as_str(), address.email.as_str()).into(),
    )
}

fn mime_addresses(addresses: &[Address]) -> MimeAddress<'_> {
    addresses
        .iter()
        .map(mime_address)
        .collect::<Vec<_>>()
        .into()
}
