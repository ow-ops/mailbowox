mod search;
mod sync;

use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashMap},
    num::NonZeroU32,
    sync::Arc,
    time::Duration,
};

use async_lock::Mutex;
use io_imap::{
    rfc3501::{
        copy::{ImapCopyUid, ImapMessageCopy, ImapMessageCopyOptions},
        create::ImapMailboxCreate,
        fetch::{
            ImapMessageFetch, ImapMessageFetchError, ImapMessageFetchFirst, ImapMessageFetchOptions,
        },
        list::ImapMailboxList,
        search::{ImapMessageSearch, ImapMessageSearchOptions},
        select::ImapMailboxSelectData,
        store::{ImapMessageStoreOptions, ImapMessageStoreSilent},
    },
    rfc4315::{
        appenduid::{ImapAppendUid, ImapAppendUidOptions},
        expunge_uid::ImapMessageExpungeUid,
    },
    rfc6851::r#move::{ImapMessageMove, ImapMessageMoveOptions},
    types::{
        command::SelectParameter,
        core::{Literal, Vec1},
        extensions::binary::LiteralOrLiteral8,
        fetch::{MacroOrMessageDataItemNames, MessageDataItem, MessageDataItemName, Part, Section},
        flag::{Flag, StoreType},
        mailbox::{ListMailbox, Mailbox as ImapMailbox},
        response::Capability,
        search::SearchKey,
        sequence::SequenceSet,
    },
};

use crate::{
    body,
    error::CoreError,
    imap::{ImapConn, mailbox_name, range_set, uid_set},
    summary::{flags_of, summary, summary_items, uid_flags_items, uid_of},
    transport::{self, AddrFilter},
    types::{
        AccountConfig, AttachmentInfo, Credentials, Flags, KnownMessage, Mailbox, MailboxRole,
        MailboxUids, MessageBody, MessageSummary, ServerConfig, SyncResult, SyncState,
    },
};

/// How many times wider than `limit` the UID range of `fetch_older` starts and grows.
const OLDER_SPAN: u32 = 4;

/// RFC 2177 asks clients to re-issue IDLE at least every 29 minutes.
const MAX_IDLE: Duration = Duration::from_mins(29);

/// One authenticated IMAP connection. Calls are serialised on it, so a
/// `waitForChanges` blocks the session's other calls until it returns. A call
/// that fails on the wire, or is dropped before it returns, ends the session:
/// every later call fails with `Network`, and the caller connects again.
#[derive(uniffi::Object)]
pub struct MailSession {
    inner: Mutex<Option<Inner>>,
}

struct Inner {
    conn: ImapConn,
    /// The state each mailbox had at its last sync, for `wait_for_changes`.
    synced: HashMap<String, SyncState>,
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl MailSession {
    #[uniffi::constructor]
    #[cfg_attr(
        target_arch = "wasm32",
        allow(
            clippy::arc_with_non_send_sync,
            reason = "wasm is single-threaded and UniFFI wants an Arc"
        )
    )]
    pub async fn connect(config: AccountConfig) -> Result<Arc<Self>, CoreError> {
        Ok(Arc::new(
            Self::open(&config.imap, &config.credentials, None).await?,
        ))
    }

    pub async fn list_mailboxes(&self) -> Result<Vec<Mailbox>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        let reference = ImapMailbox::try_from("").map_err(CoreError::protocol)?;
        let pattern = ListMailbox::try_from("*").map_err(CoreError::protocol)?;
        let listing = conn.exec(ImapMailboxList::new(reference, pattern)).await?;

        Ok(listing
            .data
            .into_iter()
            .map(|(mailbox, delimiter, attributes)| {
                let name = match mailbox {
                    ImapMailbox::Inbox => "INBOX".to_owned(),
                    ImapMailbox::Other(other) => {
                        String::from_utf8_lossy(other.inner().as_ref()).into_owned()
                    }
                };
                let attributes: Vec<String> = attributes
                    .iter()
                    .map(|attribute| attribute.to_string().to_ascii_lowercase())
                    .collect();
                Mailbox {
                    role: role(&name, &attributes),
                    selectable: !attributes
                        .iter()
                        .any(|a| a == "\\noselect" || a == "\\nonexistent"),
                    delimiter: delimiter.map(|d| d.inner().to_string()),
                    name,
                }
            })
            .collect())
    }

    pub async fn create_mailbox(&self, name: String) -> Result<(), CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        conn.exec(ImapMailboxCreate::new(mailbox_name(&name)?))
            .await
    }

    /// New and changed messages since `since`, newest first, at most `limit`
    /// new ones. `known` is what the caller has cached of the mailbox: with
    /// QRESYNC the server names the changes, otherwise the server's UIDs and
    /// flags are compared with it. Either way the session keeps nothing, so a
    /// new session carries on from the same `since` and `known`. A reset
    /// comes only without `since` or when the UID validity changed.
    pub async fn sync(
        &self,
        mailbox: String,
        since: Option<SyncState>,
        known: Vec<KnownMessage>,
        limit: u32,
    ) -> Result<SyncResult, CoreError> {
        let mut guard = self.inner.lock().await;
        let inner = open(&mut guard)?;
        let result = inner.sync(&mailbox, since, &known, limit).await?;
        inner.synced.insert(mailbox, result.state);
        Ok(result)
    }

    /// The newest `limit` messages with a UID below `before_uid`, newest first.
    pub async fn fetch_older(
        &self,
        mailbox: String,
        uid_validity: u32,
        before_uid: u32,
        limit: u32,
    ) -> Result<Vec<MessageSummary>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        conn.ensure_selected(&mailbox, uid_validity).await?;

        let Some(last) = before_uid.checked_sub(1).filter(|&last| last > 0) else {
            return Ok(Vec::new());
        };
        // UIDs have holes, so the range that holds `limit` messages is not known ahead: it widens until it
        // does or reaches the first UID, which keeps the answer short in a large mailbox.
        let mut span = limit.max(1).saturating_mul(OLDER_SPAN);
        let uids = loop {
            let first = last.saturating_sub(span).max(1);
            let Some(older) = range_set(first, Some(last)) else {
                return Ok(Vec::new());
            };
            let found = conn
                .exec(ImapMessageSearch::new(
                    Vec1::from(SearchKey::Uid(older)),
                    ImapMessageSearchOptions { uid: true },
                ))
                .await?;
            if found.data.len() >= limit as usize || first == 1 {
                let mut uids: Vec<u32> = found.data.into_iter().map(NonZeroU32::get).collect();
                uids.sort_unstable();
                break uids;
            }
            span = span.saturating_mul(OLDER_SPAN);
        };
        summaries(conn, &uids[uids.len().saturating_sub(limit as usize)..]).await
    }

    /// Downloads and parses the whole message, which marks it \\Seen.
    pub async fn fetch_body(
        &self,
        mailbox: String,
        uid_validity: u32,
        uid: u32,
        allow_remote: bool,
    ) -> Result<MessageBody, CoreError> {
        let raw = self.fetch_raw(&mailbox, uid_validity, uid, false).await?;
        body::message_body(uid, &raw, allow_remote)
    }

    /// `attachment` is one of those `fetch_body` listed. Downloads that part
    /// alone when it has a `section` and the server holds the same part
    /// there, else the whole message.
    pub async fn fetch_attachment(
        &self,
        mailbox: String,
        uid_validity: u32,
        uid: u32,
        attachment: AttachmentInfo,
    ) -> Result<Vec<u8>, CoreError> {
        if let Some(part) = self
            .fetch_part(&mailbox, uid_validity, uid, &attachment)
            .await?
        {
            return Ok(part);
        }
        let raw = self.fetch_raw(&mailbox, uid_validity, uid, true).await?;
        body::attachment(&raw, attachment.index)
    }

    /// Only the fields set to true in `add` and `remove` are touched.
    pub async fn set_flags(
        &self,
        mailbox: String,
        uid_validity: u32,
        uids: Vec<u32>,
        add: Flags,
        remove: Flags,
    ) -> Result<(), CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        let Some(set) = uid_set(&uids) else {
            return Ok(());
        };
        conn.ensure_selected(&mailbox, uid_validity).await?;
        for (kind, flags) in [(StoreType::Add, add), (StoreType::Remove, remove)] {
            let flags = flags.to_imap();
            if !flags.is_empty() {
                store(conn, set.clone(), kind, flags).await?;
            }
        }
        Ok(())
    }

    /// Uses MOVE, else COPY, \\Deleted and UID EXPUNGE. When reported by the
    /// server, returns the destination UIDs and their UIDVALIDITY.
    pub async fn move_messages(
        &self,
        mailbox: String,
        uid_validity: u32,
        uids: Vec<u32>,
        destination: String,
    ) -> Result<Option<MailboxUids>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        let Some(set) = uid_set(&uids) else {
            return Ok(None);
        };
        conn.ensure_selected(&mailbox, uid_validity).await?;
        let destination = mailbox_name(&destination)?;

        let rev2 = conn.imap4rev2();
        let copied = if rev2 || conn.has(&Capability::Move) {
            let opts = ImapMessageMoveOptions { uid: true };
            conn.exec(ImapMessageMove::new(set, destination, opts))
                .await?
        } else {
            require_uid_expunge(conn)?;
            let opts = ImapMessageCopyOptions { uid: true };
            let copied = conn
                .exec(ImapMessageCopy::new(set.clone(), destination, opts))
                .await?;
            delete(conn, set).await?;
            copied
        };
        Ok(copied
            .filter(|copy| copy.uid_validity != 0)
            .map(|copy| MailboxUids {
                uid_validity: copy.uid_validity,
                uids: new_uids(&uids, &copy),
            }))
    }

    /// UIDs of messages whose sender, recipients, subject or body contain
    /// every word of `query`, newest first; `Invalid` for a blank query.
    /// `from:`, `to:`, `cc:` and `subject:` keep a word to that field;
    /// `is:unread`, `is:read` and `is:starred` filter on flags.
    pub async fn search(&self, mailbox: String, query: String) -> Result<MailboxUids, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        let uid_validity = conn.selected_uid_validity(&mailbox).await?;
        let found = conn
            .exec(ImapMessageSearch::new(
                search::search_criteria(&query)?,
                ImapMessageSearchOptions { uid: true },
            ))
            .await?;
        let mut uids: Vec<u32> = found.data.into_iter().map(NonZeroU32::get).collect();
        uids.sort_unstable_by_key(|&uid| Reverse(uid));
        Ok(MailboxUids { uid_validity, uids })
    }

    /// Newest first.
    pub async fn fetch_summaries(
        &self,
        mailbox: String,
        uid_validity: u32,
        uids: Vec<u32>,
    ) -> Result<Vec<MessageSummary>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        conn.ensure_selected(&mailbox, uid_validity).await?;
        summaries(conn, &uids).await
    }

    /// Marks the messages \\Deleted and expunges them.
    pub async fn delete_messages(
        &self,
        mailbox: String,
        uid_validity: u32,
        uids: Vec<u32>,
    ) -> Result<(), CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        let Some(set) = uid_set(&uids) else {
            return Ok(());
        };
        conn.ensure_selected(&mailbox, uid_validity).await?;
        require_uid_expunge(conn)?;
        delete(conn, set).await
    }

    /// The new message's UID, when the server reports it (UIDPLUS).
    pub async fn append(
        &self,
        mailbox: String,
        raw: Vec<u8>,
        flags: Flags,
    ) -> Result<Option<u32>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        let message = LiteralOrLiteral8::Literal(Literal::unvalidated(raw));
        let opts = ImapAppendUidOptions {
            flags: flags.to_imap(),
            date: None,
        };
        let appended = conn
            .exec(ImapAppendUid::new(mailbox_name(&mailbox)?, message, opts))
            .await?;
        Ok(appended.map(|(_, uid)| uid.get()))
    }

    /// Waits until the mailbox changes or `timeout_secs` pass; true on a
    /// change. A change since the last `sync` returns at once. Capped at 29
    /// minutes. Holds the connection, so use a session of its own.
    pub async fn wait_for_changes(
        &self,
        mailbox: String,
        timeout_secs: u32,
    ) -> Result<bool, CoreError> {
        let mut guard = self.inner.lock().await;
        let inner = open(&mut guard)?;
        let timeout = Duration::from_secs(timeout_secs.into()).min(MAX_IDLE);
        let last = inner.synced.get(&mailbox).copied();

        let now = inner.select_state(&mailbox).await?;
        if last.is_some_and(|last| last != now) {
            return Ok(true);
        }
        if inner.conn.has(&Capability::Idle) {
            return inner.conn.idle(timeout).await;
        }
        transport::sleep(timeout).await;
        Ok(inner.select_state(&mailbox).await? != now)
    }

    pub async fn logout(&self) -> Result<(), CoreError> {
        let Some(inner) = self.inner.lock().await.take() else {
            return Ok(());
        };
        // A connection out of step with the protocol can't be told goodbye; dropping it closes it.
        if inner.conn.broken() {
            return Ok(());
        }
        inner.conn.logout().await
    }
}

impl MailSession {
    /// Logs in to IMAP alone, for callers that never send mail. With
    /// `allowed`, connects only to addresses it accepts.
    pub async fn open(
        server: &ServerConfig,
        credentials: &Credentials,
        allowed: Option<AddrFilter>,
    ) -> Result<Self, CoreError> {
        let conn = ImapConn::open(server, credentials, allowed).await?;
        Ok(Self {
            inner: Mutex::new(Some(Inner {
                conn,
                synced: HashMap::new(),
            })),
        })
    }

    /// The mailbox's state and how many of its messages are unseen. Like
    /// `sync`, this is the state the next `wait_for_changes` compares with.
    pub async fn unseen(&self, mailbox: &str) -> Result<(SyncState, u32), CoreError> {
        let mut guard = self.inner.lock().await;
        let inner = open(&mut guard)?;
        let state = inner.select_state(mailbox).await?;
        let found = inner
            .conn
            .exec(ImapMessageSearch::new(
                Vec1::from(SearchKey::Unseen),
                ImapMessageSearchOptions { uid: false },
            ))
            .await?;
        inner.synced.insert(mailbox.to_owned(), state);
        Ok((state, u32::try_from(found.data.len()).unwrap_or(u32::MAX)))
    }

    /// The newest message from UID `first` up to `state`.
    pub async fn newest_since(
        &self,
        mailbox: &str,
        state: SyncState,
        first: u32,
    ) -> Result<Option<MessageSummary>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        conn.ensure_selected(mailbox, state.uid_validity).await?;
        // Not `first:*`, which matches the newest message even below `first`.
        let Some(range) = range_set(first, state.uid_next.checked_sub(1)) else {
            return Ok(None);
        };
        let found = conn
            .exec(ImapMessageSearch::new(
                Vec1::from(SearchKey::Uid(range)),
                ImapMessageSearchOptions { uid: true },
            ))
            .await?;
        let Some(uid) = found.data.into_iter().map(NonZeroU32::get).max() else {
            return Ok(None);
        };
        Ok(summaries(conn, &[uid]).await?.into_iter().next())
    }

    /// `None` when the part can't be fetched by its section, or isn't the one expected.
    async fn fetch_part(
        &self,
        mailbox: &str,
        uid_validity: u32,
        uid: u32,
        attachment: &AttachmentInfo,
    ) -> Result<Option<Vec<u8>>, CoreError> {
        let numbers: Option<Vec<NonZeroU32>> = attachment.section.as_deref().and_then(|section| {
            section
                .split('.')
                .map(|number| number.parse().ok())
                .collect()
        });
        let (Some(part), Some(id)) = (
            numbers
                .and_then(|numbers| Vec1::try_from(numbers).ok())
                .map(Part),
            NonZeroU32::new(uid),
        ) else {
            return Ok(None);
        };

        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        conn.ensure_selected(mailbox, uid_validity).await?;
        let item = |section| MessageDataItemName::BodyExt {
            section: Some(section),
            partial: None,
            peek: true,
        };
        let items = MacroOrMessageDataItemNames::MessageDataItemNames(vec![
            item(Section::Mime(part.clone())),
            item(Section::Part(part)),
        ]);
        let opts = ImapMessageFetchOptions {
            uid: true,
            ..Default::default()
        };
        // A server that refuses the sections still has the whole message.
        let Ok(items) = conn
            .run(ImapMessageFetchFirst::new(id, items, opts))
            .await?
        else {
            return Ok(None);
        };
        let (mut header, mut content) = (None, None);
        for item in items {
            match item {
                MessageDataItem::BodyExt {
                    section: Some(Section::Mime(_)),
                    data,
                    ..
                } => header = data.0,
                MessageDataItem::BodyExt {
                    section: Some(Section::Part(_)),
                    data,
                    ..
                } => content = data.0,
                _ => {}
            }
        }
        Ok(header.zip(content).and_then(|(header, content)| {
            body::lone_part(header.as_ref(), content.as_ref(), attachment)
        }))
    }

    async fn fetch_raw(
        &self,
        mailbox: &str,
        uid_validity: u32,
        uid: u32,
        peek: bool,
    ) -> Result<Vec<u8>, CoreError> {
        let mut guard = self.inner.lock().await;
        let conn = &mut open(&mut guard)?.conn;
        conn.ensure_selected(mailbox, uid_validity).await?;

        let id = NonZeroU32::new(uid).ok_or_else(|| CoreError::invalid("UID 0"))?;
        let items =
            MacroOrMessageDataItemNames::MessageDataItemNames(vec![MessageDataItemName::BodyExt {
                section: None,
                partial: None,
                peek,
            }]);
        let opts = ImapMessageFetchOptions {
            uid: true,
            ..Default::default()
        };
        let items = match conn
            .run(ImapMessageFetchFirst::new(id, items, opts))
            .await?
        {
            Ok(items) => items,
            Err(ImapMessageFetchError::MissingData) => {
                return Err(CoreError::not_found(format!("no message with UID {uid}")));
            }
            Err(err) => return Err(CoreError::protocol(err)),
        };
        items
            .into_iter()
            .find_map(|item| match item {
                MessageDataItem::BodyExt {
                    section: None,
                    data,
                    ..
                } => data.0,
                _ => None,
            })
            .map(|data| data.into_inner().into_owned())
            .ok_or_else(|| CoreError::protocol("the server sent no message body"))
    }
}

async fn summaries(conn: &mut ImapConn, uids: &[u32]) -> Result<Vec<MessageSummary>, CoreError> {
    match uid_set(uids) {
        Some(set) => fetch_summaries(conn, set, true).await,
        None => Ok(Vec::new()),
    }
}

async fn fetch_summaries(
    conn: &mut ImapConn,
    set: SequenceSet,
    uid: bool,
) -> Result<Vec<MessageSummary>, CoreError> {
    let opts = ImapMessageFetchOptions {
        uid,
        ..Default::default()
    };
    let fetched = conn
        .exec(ImapMessageFetch::new(set, summary_items(), opts))
        .await?;
    let mut list: Vec<MessageSummary> = fetched
        .data
        .values()
        .filter_map(|items| summary(items.as_ref()))
        .collect();
    list.sort_unstable_by_key(|summary| Reverse(summary.uid));
    Ok(list)
}

async fn fetch_flags(
    conn: &mut ImapConn,
    set: Option<SequenceSet>,
) -> Result<BTreeMap<u32, Flags>, CoreError> {
    let Some(set) = set else {
        return Ok(BTreeMap::new());
    };
    let opts = ImapMessageFetchOptions {
        uid: true,
        ..Default::default()
    };
    let fetched = conn
        .exec(ImapMessageFetch::new(set, uid_flags_items(), opts))
        .await?;
    Ok(fetched
        .data
        .values()
        .filter_map(|items| Some((uid_of(items.as_ref())?, flags_of(items.as_ref())?)))
        .collect())
}

async fn store(
    conn: &mut ImapConn,
    set: SequenceSet,
    kind: StoreType,
    flags: Vec<Flag<'static>>,
) -> Result<(), CoreError> {
    let opts = ImapMessageStoreOptions { uid: true };
    conn.exec(ImapMessageStoreSilent::new(set, kind, flags, opts))
        .await
}

fn require_uid_expunge(conn: &ImapConn) -> Result<(), CoreError> {
    if conn.imap4rev2() || conn.has(&Capability::UidPlus) {
        Ok(())
    } else {
        Err(CoreError::invalid(
            "this server cannot expunge selected messages safely",
        ))
    }
}

async fn delete(conn: &mut ImapConn, set: SequenceSet) -> Result<(), CoreError> {
    store(conn, set.clone(), StoreType::Add, vec![Flag::Deleted]).await?;
    conn.exec(ImapMessageExpungeUid::new(set)).await.map(drop)
}

fn new_uids(uids: &[u32], copied: &ImapCopyUid) -> Vec<u32> {
    let pairs: HashMap<u32, u32> = copied
        .pairs()
        .map(|(from, to)| (from.get(), to.get()))
        .collect();
    uids.iter()
        .map(|uid| pairs.get(uid).copied())
        .collect::<Option<_>>()
        .unwrap_or_default()
}

fn condstore_parameters(conn: &ImapConn) -> Vec<SelectParameter> {
    if conn.condstore() {
        vec![SelectParameter::CondStore]
    } else {
        Vec::new()
    }
}

fn state_of(selected: &ImapMailboxSelectData) -> SyncState {
    SyncState {
        uid_validity: selected.uid_validity.map_or(0, NonZeroU32::get),
        uid_next: selected.uid_next.map_or(0, NonZeroU32::get),
        highest_modseq: selected.highest_mod_seq,
    }
}

fn open(inner: &mut Option<Inner>) -> Result<&mut Inner, CoreError> {
    if inner.as_ref().is_some_and(|inner| inner.conn.broken()) {
        *inner = None;
        return Err(CoreError::Network {
            message: "the connection was lost during an earlier call".to_owned(),
        });
    }
    inner
        .as_mut()
        .ok_or_else(|| CoreError::invalid("the session is logged out"))
}

/// RFC 6154 special-use attributes first, then the usual folder names.
fn role(name: &str, attributes: &[String]) -> Option<MailboxRole> {
    if name.eq_ignore_ascii_case("INBOX") {
        return Some(MailboxRole::Inbox);
    }
    let by_attribute = attributes
        .iter()
        .find_map(|attribute| match attribute.as_str() {
            "\\sent" => Some(MailboxRole::Sent),
            "\\drafts" => Some(MailboxRole::Drafts),
            "\\trash" => Some(MailboxRole::Trash),
            "\\junk" => Some(MailboxRole::Junk),
            "\\archive" => Some(MailboxRole::Archive),
            "\\all" => Some(MailboxRole::All),
            "\\flagged" => Some(MailboxRole::Flagged),
            _ => None,
        });
    by_attribute.or_else(|| match name.to_ascii_lowercase().as_str() {
        "sent" | "sent items" | "sent messages" => Some(MailboxRole::Sent),
        "drafts" => Some(MailboxRole::Drafts),
        "trash" | "deleted items" | "deleted messages" => Some(MailboxRole::Trash),
        "junk" | "spam" | "junk mail" | "junk e-mail" => Some(MailboxRole::Junk),
        "archive" | "archives" => Some(MailboxRole::Archive),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::role;
    use crate::types::MailboxRole;

    #[test]
    fn special_use_attributes_win_over_names() {
        let attributes = ["\\hasnochildren".to_owned(), "\\sent".to_owned()];
        assert_eq!(role("Gesendet", &attributes), Some(MailboxRole::Sent));
        assert_eq!(
            role("Trash", &["\\junk".to_owned()]),
            Some(MailboxRole::Junk)
        );
    }

    #[test]
    fn common_names_give_a_role_without_attributes() {
        assert_eq!(role("inbox", &[]), Some(MailboxRole::Inbox));
        assert_eq!(role("Sent Items", &[]), Some(MailboxRole::Sent));
        assert_eq!(role("Spam", &[]), Some(MailboxRole::Junk));
        assert_eq!(role("Receipts", &[]), None);
    }
}
