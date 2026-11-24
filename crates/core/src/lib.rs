//! Mail core shared by the app on every platform, exported through `UniFFI`;
//! the generated bindings are the contract. On web it is a WebAssembly
//! module, so await `uniffiInitAsync` before the first call. Every call is
//! async except `build_message` and `configure_relay`.

#![allow(
    clippy::missing_errors_doc,
    reason = "every call fails with CoreError, described on the enum"
)]
#![cfg_attr(
    test,
    allow(
        clippy::must_use_candidate,
        reason = "the parsers are re-exported for the property tests only"
    )
)]

mod body;
mod carddav;
mod compose;
mod dav;
mod discover;
mod error;
mod imap;
#[cfg(test)]
mod parsers;
mod probe;
#[cfg(test)]
mod properties;
mod providers;
mod sanitize;
mod session;
mod smtp;
mod summary;
mod tls;
mod transport;
mod types;
mod unsubscribe;
mod vcard;

pub use error::{CoreError, TlsFailure};
pub use session::MailSession;
pub use transport::AddrFilter;
pub use types::*;

use imap::ImapConn;
use smtp::SmtpConn;

#[cfg(target_arch = "wasm32")]
extern crate uniffi_runtime_wasm as _;

uniffi::setup_scaffolding!();

/// Sets the gateway (`http://` or `https://`) whose `/relay` the web build
/// tunnels connections through; `Invalid` for another scheme. Native builds
/// connect directly and ignore it. The token goes in the WebSocket
/// subprotocol, not the URL.
#[uniffi::export]
#[allow(
    clippy::needless_pass_by_value,
    reason = "UniFFI hands strings over by value"
)]
pub fn configure_relay(url: String, token: String) -> Result<(), CoreError> {
    transport::configure_relay(&url, token)
}

/// Autoconfig, ISPDB, known hosts, SRV, the MX host, then common host names;
/// `None` when nothing turns up. The MX host's registrable domain is also
/// looked up in known hosts and the ISPDB, to find the provider behind a
/// custom domain. The last step probes `imap.`, `smtp.`, `mail.`, the bare
/// domain and the MX host at once (993 then 143; 465 then 587 for SMTP) and
/// takes the first that greets over TLS or STARTTLS. No credentials are sent.
/// DNS goes over HTTPS to Cloudflare.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn discover(email: String) -> Result<Option<DiscoveredSettings>, CoreError> {
    discover::discover(&email).await
}

/// Logs in to IMAP, then disconnects.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn verify_incoming(config: AccountConfig) -> Result<(), CoreError> {
    ImapConn::open(&config.imap, &config.credentials, None)
        .await?
        .logout()
        .await
}

/// Logs in to SMTP, then disconnects.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn verify_outgoing(config: AccountConfig) -> Result<(), CoreError> {
    SmtpConn::open(&config.smtp, &config.credentials)
        .await?
        .quit()
        .await
}

/// Submits the draft and returns the raw message, for appending to Sent.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn send_message(config: AccountConfig, draft: Draft) -> Result<Vec<u8>, CoreError> {
    let raw = compose::build(&draft)?;
    let recipients: Vec<&str> = [&draft.to, &draft.cc, &draft.bcc]
        .into_iter()
        .flatten()
        .map(|address| address.email.as_str())
        .collect();
    if recipients.is_empty() {
        return Err(CoreError::invalid("the draft has no recipients"));
    }

    let mut smtp = SmtpConn::open(&config.smtp, &config.credentials).await?;
    smtp.send(&draft.from.email, &recipients, raw.clone())
        .await?;
    // The server took the message when it answered the final dot; a failed QUIT changes nothing about that, and
    // reporting it would send the message again.
    let _ = smtp.quit().await;
    Ok(raw)
}

/// Builds the raw message without sending it, for saving drafts.
#[uniffi::export]
#[allow(
    clippy::needless_pass_by_value,
    reason = "UniFFI hands records over by value"
)]
pub fn build_message(draft: Draft) -> Result<Vec<u8>, CoreError> {
    compose::build(&draft)
}

/// Address book home URL, or `None` when the account has no contact service.
/// Discovers the server from the account's domains or the supplied `carddav_url`,
/// then looks up the address-book home set.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn discover_contacts(config: AccountConfig) -> Result<Option<String>, CoreError> {
    carddav::discover(&config).await
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn list_address_books(
    config: AccountConfig,
    home: String,
) -> Result<Vec<AddressBook>, CoreError> {
    carddav::list(&config, &home).await
}

/// sync-collection when the address book supports it, else the ctag and an
/// etag listing diffed against `known`.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn sync_contacts(
    config: AccountConfig,
    address_book: String,
    since: Option<ContactSyncState>,
    known: Vec<ContactTag>,
) -> Result<ContactSyncResult, CoreError> {
    carddav::sync(&config, &address_book, since, &known).await
}

/// Writes a vCard 3.0 with a new UID, as `<uid>.vcf`.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn create_contact(
    config: AccountConfig,
    address_book: String,
    draft: ContactDraft,
) -> Result<Contact, CoreError> {
    carddav::create(&config, &address_book, &draft).await
}

/// Rewrites the name, emails, phones and organization of `contact.vcard`;
/// everything else on the card, its version included, is kept.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn update_contact(
    config: AccountConfig,
    contact: Contact,
    draft: ContactDraft,
) -> Result<Contact, CoreError> {
    carddav::update(&config, &contact, &draft).await
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn delete_contact(
    config: AccountConfig,
    href: String,
    etag: Option<String>,
) -> Result<(), CoreError> {
    carddav::delete(&config, &href, etag.as_deref()).await
}

/// Posts `List-Unsubscribe=One-Click` to the list's https URL (RFC 8058).
/// A 2xx or 3xx answer counts as done; redirects are not followed.
#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
pub async fn unsubscribe_one_click(url: String) -> Result<(), CoreError> {
    unsubscribe::one_click(&url).await
}
