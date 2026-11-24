#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Security {
    Tls,
    StartTls,
    /// Only for the local test server.
    Plain,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub security: Security,
}

#[derive(Clone, PartialEq, Eq, uniffi::Record)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("username", &self.username)
            .finish_non_exhaustive()
    }
}

/// `CardDAV` calls reuse `credentials`. Address-book URLs are absolute.
/// Plain `http` is accepted only when `carddav_url` is `http`
/// and the IMAP security is `Plain` (the local test server).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountConfig {
    pub email: String,
    pub display_name: String,
    pub imap: ServerConfig,
    pub smtp: ServerConfig,
    pub credentials: Credentials,
    /// Where contact discovery starts instead of the email domain's records.
    pub carddav_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum, serde::Serialize, serde::Deserialize)]
pub enum MailboxRole {
    Inbox,
    Sent,
    Drafts,
    Trash,
    Junk,
    Archive,
    All,
    Flagged,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct Mailbox {
    pub name: String,
    pub delimiter: Option<String>,
    pub role: Option<MailboxRole>,
    pub selectable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize,
)]
#[expect(clippy::struct_excessive_bools, reason = "IMAP's system flags")]
pub struct Flags {
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub draft: bool,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct MessageSummary {
    pub uid: u32,
    pub flags: Flags,
    pub subject: String,
    pub from: Vec<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// Where the sender asks for replies, when not to `from`.
    pub reply_to: Vec<Address>,
    /// The addresses the receiving server recorded the message as delivered to.
    pub delivered_to: Vec<String>,
    /// Unix seconds.
    pub date: i64,
    /// Message ids carry no angle brackets, here and in `in_reply_to` and
    /// `references`.
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    /// The first ~200 characters of the text.
    pub preview: String,
    pub has_attachments: bool,
    pub size: u32,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize,
)]
pub struct SyncState {
    pub uid_validity: u32,
    pub uid_next: u32,
    pub highest_modseq: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MailboxUids {
    pub uid_validity: u32,
    pub uids: Vec<u32>,
}

/// A message the caller has cached, for `sync` to compare with the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct KnownMessage {
    pub uid: u32,
    pub flags: Flags,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SyncResult {
    pub state: SyncState,
    /// The cached copy of the mailbox is stale (the UID validity changed or
    /// there was no prior state): drop it and start over from `changed`.
    pub reset: bool,
    /// New or flag-changed messages, newest first; at most `limit` new ones.
    pub changed: Vec<MessageSummary>,
    /// The `known` UIDs that are gone from the server.
    pub vanished: Vec<u32>,
    /// More than `limit` messages are new: those older than the new ones in
    /// `changed` were left out, so the cache has a gap below them.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct AttachmentInfo {
    /// The part's position in the parsed message, for `fetch_attachment`.
    pub index: u32,
    pub filename: Option<String>,
    pub mime_type: String,
    pub size: u32,
    pub content_id: Option<String>,
    pub inline: bool,
    /// Where the part is in the message as IMAP numbers it ("2", "1.3"),
    /// for fetching it alone. `None` for a part that has no such number of
    /// its own: the only part of a message, or one inside an attached message.
    pub section: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct MessageBody {
    pub uid: u32,
    /// Sanitised: no scripts, forms, event handlers or `<style>` blocks, and
    /// remote resources removed unless `allow_remote`. Images the message
    /// carries and names by `cid:` are inlined as `data:` URLs.
    pub html: Option<String>,
    pub text: Option<String>,
    pub has_remote_content: bool,
    /// Remote loads removed from `html` (images, backgrounds, style URLs); 0
    /// with `allow_remote`.
    pub blocked_remote: u32,
    pub attachments: Vec<AttachmentInfo>,
    /// The `mailto:` and `https:` URLs of `List-Unsubscribe`, in its order.
    pub list_unsubscribe: Vec<String>,
    /// `List-Unsubscribe-Post` asks for one-click unsubscription (RFC 8058):
    /// a POST to the https URL, with `unsubscribe_one_click`.
    pub list_unsubscribe_one_click: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct OutgoingAttachment {
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct Draft {
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub text: String,
    pub html: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    /// Kept in rows of their own by the outbox.
    #[serde(skip)]
    pub attachments: Vec<OutgoingAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DiscoveredSettings {
    /// `imap` and `smtp` are both set, except when a probe reached only one.
    pub imap: Option<ServerConfig>,
    pub smtp: Option<ServerConfig>,
    pub username: String,
    /// `autoconfig`, `ispdb`, `provider`, `srv`, `mx` or `probe`.
    pub source: String,
    /// `carddav_url` comes from the known hosts only.
    pub carddav_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AddressBook {
    pub href: String,
    pub name: String,
    pub ctag: Option<String>,
    pub sync_token: Option<String>,
    pub read_only: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct ContactSyncState {
    pub sync_token: Option<String>,
    pub ctag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ContactTag {
    pub href: String,
    pub etag: String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record, serde::Serialize, serde::Deserialize)]
pub struct ContactValue {
    pub value: String,
    /// The first TYPE parameter, lowercased, such as work, home or cell; `pref`
    /// and `internet` are skipped.
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Contact {
    /// Empty when the card has no UID.
    pub uid: String,
    pub href: String,
    pub etag: Option<String>,
    /// The card's FN, else its first email address, else empty.
    pub name: String,
    pub given: Option<String>,
    pub family: Option<String>,
    pub emails: Vec<ContactValue>,
    pub phones: Vec<ContactValue>,
    /// The first component of ORG.
    pub organization: Option<String>,
    /// A URI as the card has it, or a data: URI for an inline photo.
    pub photo: Option<String>,
    /// The whole card, for update.
    pub vcard: String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ContactSyncResult {
    pub state: ContactSyncState,
    /// The cached contacts of the address book are stale: drop them and start
    /// over from `changed`.
    pub reset: bool,
    pub changed: Vec<Contact>,
    /// Hrefs of the deleted contacts.
    pub removed: Vec<String>,
}

/// The fields an update rewrites; the card's other properties, its photo
/// included, stay as they are.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ContactDraft {
    pub name: String,
    pub given: Option<String>,
    pub family: Option<String>,
    pub emails: Vec<ContactValue>,
    pub phones: Vec<ContactValue>,
    pub organization: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MailItem {
    pub account: String,
    pub mailbox: String,
    pub uid_validity: u32,
    pub summary: MessageSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StoredMessage {
    pub account: String,
    pub mailbox: String,
    pub uid_validity: u32,
    pub uid: u32,
    pub thread: String,
    pub summary: MessageSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MessageRef {
    pub account: String,
    pub mailbox: String,
    pub uid_validity: u32,
    pub uid: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct Oldest {
    pub uid: u32,
    pub date: i64,
    pub uid_validity: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SyncOutcome {
    pub reset: bool,
    pub truncated: bool,
    /// Unread messages new since the last sync; empty on the first sync and on a reset.
    pub arrived: Vec<MessageSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MailboxRef {
    pub account: String,
    pub mailbox: String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PageCursor {
    pub date: i64,
    pub account: String,
    pub uid: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
#[expect(clippy::struct_excessive_bools, reason = "each filter is on or off")]
pub struct ListFilter {
    pub unread: bool,
    pub flagged: bool,
    pub attachments: bool,
    /// Mail with one of `me` in To or Cc.
    pub to_me: bool,
    pub me: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Conversation {
    /// The newest message in the viewed mailbox.
    pub latest: StoredMessage,
    /// The whole conversation across the account's mailboxes, oldest first, one copy per message.
    pub messages: Vec<StoredMessage>,
    /// Its messages in the viewed mailbox, oldest first.
    pub in_view: Vec<StoredMessage>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct SearchQuery {
    /// Normalized words, each of which must appear.
    pub terms: Vec<String>,
    /// Some terms belong to one field (`from:`, `subject:`), which the app checks.
    pub fields: bool,
    pub seen: Option<bool>,
    pub flagged: bool,
    pub attachments: bool,
}

/// A message waiting in the outbox; its draft comes without the attachments.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct QueuedMessage {
    pub id: i64,
    pub account: String,
    /// Unix seconds.
    pub queued_at: i64,
    pub error: Option<String>,
    pub draft: Draft,
}

/// An attachment of a composer's local draft. One that was still downloading
/// when the draft was kept has no data, and is fetched again when it reopens.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DraftAttachment {
    pub key: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub data: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StoredAddressBook {
    pub account: String,
    pub book: AddressBook,
}

/// A row of the contact list: the first address stands for the contact.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ContactRow {
    pub account: String,
    pub href: String,
    pub name: String,
    pub organization: Option<String>,
    pub email: Option<String>,
    /// What the list sorts by, family name first; its first letter heads a section.
    pub sort: String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ContactAddress {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StoredContact {
    pub account: String,
    pub book: String,
    pub contact: Contact,
}
