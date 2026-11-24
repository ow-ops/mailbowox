use std::collections::HashMap;

use crate::types::{MessageSummary, StoredMessage};

#[derive(Debug, Default)]
pub(super) struct ThreadIndex {
    pub ids: HashMap<String, String>,
    pub subjects: HashMap<String, String>,
}

fn strip_prefix(subject: &str) -> Option<(&str, bool)> {
    let text = subject.trim_start();
    ["re", "fwd", "fw"].into_iter().find_map(|prefix| {
        let head = text.get(..prefix.len())?;
        let rest = text.get(prefix.len()..)?.trim_start().strip_prefix(':')?;
        head.eq_ignore_ascii_case(prefix)
            .then_some((rest, prefix == "re"))
    })
}

pub(super) fn base_subject(subject: &str) -> String {
    let mut rest = subject;
    while let Some((stripped, _)) = strip_prefix(rest) {
        rest = stripped;
    }
    rest.trim().to_lowercase()
}

fn unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = Vec::new();
    for value in values {
        if !seen.contains(&value) {
            seen.push(value);
        }
    }
    seen
}

fn parent_ids(summary: &MessageSummary) -> Vec<String> {
    unique(
        summary
            .references
            .iter()
            .chain(&summary.in_reply_to)
            .cloned(),
    )
}

/// The root comes first: References lists the oldest ancestor first.
pub(super) fn thread_ids(summary: &MessageSummary) -> Vec<String> {
    unique(
        parent_ids(summary)
            .into_iter()
            .chain(summary.message_id.clone()),
    )
}

/// JWZ-style: a message joins the conversation of any message it references or
/// that references it, and conversations it links merge. Subject alone only
/// threads a "Re:" with no references, onto the latest conversation under that
/// subject.
fn assign(
    index: &mut ThreadIndex,
    summary: &MessageSummary,
    fallback: &str,
) -> (String, Vec<String>) {
    let parents = parent_ids(summary);
    let ids = thread_ids(summary);
    let found = unique(ids.iter().filter_map(|id| index.ids.get(id).cloned()));
    let subject = base_subject(&summary.subject);
    let orphan_reply = (parents.is_empty()
        && strip_prefix(&summary.subject).is_some_and(|(_, reply)| reply))
    .then(|| index.subjects.get(&subject).cloned())
    .flatten();
    let thread = found
        .first()
        .cloned()
        .or(orphan_reply)
        .or_else(|| ids.first().cloned())
        .unwrap_or_else(|| fallback.to_owned());
    let merged = found.get(1..).unwrap_or_default().to_vec();

    if !merged.is_empty() {
        for map in [&mut index.ids, &mut index.subjects] {
            for value in map.values_mut() {
                if merged.contains(value) {
                    value.clone_from(&thread);
                }
            }
        }
    }
    for id in ids {
        index.ids.insert(id, thread.clone());
    }
    if parents.is_empty() && !subject.is_empty() && strip_prefix(&summary.subject).is_none() {
        index.subjects.insert(subject, thread.clone());
    }
    (thread, merged)
}

pub(super) struct Assigned {
    /// In the order of the input.
    pub threads: Vec<String>,
    /// Each conversation that was absorbed, with the one it ended up in.
    pub merges: Vec<(String, String)>,
}

/// Oldest first, so a reply finds the conversation its parent started.
pub(super) fn assign_threads(
    index: &mut ThreadIndex,
    messages: &[(&MessageSummary, String)],
) -> Assigned {
    let mut order: Vec<_> = messages.iter().enumerate().collect();
    order.sort_by_key(|(_, (summary, _))| summary.date);
    let mut threads = vec![String::new(); messages.len()];
    let mut into: HashMap<String, String> = HashMap::new();
    for (position, (summary, fallback)) in order {
        let (thread, merged) = assign(index, summary, fallback);
        for from in merged {
            into.insert(from, thread.clone());
        }
        if let Some(slot) = threads.get_mut(position) {
            *slot = thread;
        }
    }
    let resolve = |thread: &str| {
        let mut current = thread.to_owned();
        while let Some(next) = into.get(&current) {
            current.clone_from(next);
        }
        current
    };
    Assigned {
        threads: threads.iter().map(|thread| resolve(thread)).collect(),
        merges: into
            .keys()
            .map(|from| (from.clone(), resolve(from)))
            .collect(),
    }
}

fn by_date(a: &StoredMessage, b: &StoredMessage) -> std::cmp::Ordering {
    a.summary.date.cmp(&b.summary.date).then(a.uid.cmp(&b.uid))
}

/// `members` is every stored message of the conversation. Messages in `hidden`
/// mailboxes (Trash, Junk) stay out unless viewed there; a message filed twice
/// (sent to yourself) shows once, preferably the copy in the viewed mailbox.
/// Both lists come back oldest first.
pub(super) fn conversation(
    latest: &StoredMessage,
    members: &[StoredMessage],
    hidden: &[String],
) -> (Vec<StoredMessage>, Vec<StoredMessage>) {
    let mut in_view: Vec<StoredMessage> = members
        .iter()
        .filter(|m| m.mailbox == latest.mailbox)
        .cloned()
        .collect();
    in_view.sort_by(by_date);
    let mut keys = Vec::new();
    let mut shown = Vec::new();
    for member in in_view
        .iter()
        .chain(members.iter().filter(|m| !hidden.contains(&m.mailbox)))
    {
        let key = member
            .summary
            .message_id
            .clone()
            .unwrap_or_else(|| format!("{}\n{}", member.mailbox, member.uid));
        if !keys.contains(&key) {
            keys.push(key);
            shown.push(member.clone());
        }
    }
    shown.sort_by(by_date);
    (shown, in_view)
}

#[cfg(test)]
mod tests {
    use super::{ThreadIndex, assign_threads, base_subject, conversation};
    use crate::types::{Address, Flags, MessageSummary, StoredMessage};

    fn message(id: Option<&str>, date: i64) -> MessageSummary {
        MessageSummary {
            uid: u32::try_from(date).expect("a small date"),
            flags: Flags::default(),
            subject: "Lunch".to_owned(),
            from: vec![Address {
                name: None,
                email: "bob@example.com".to_owned(),
            }],
            to: Vec::new(),
            cc: Vec::new(),
            reply_to: Vec::new(),
            delivered_to: Vec::new(),
            date,
            message_id: id.map(str::to_owned),
            in_reply_to: None,
            references: Vec::new(),
            preview: String::new(),
            has_attachments: false,
            size: 10,
            category: crate::category::Category::Primary,
        }
    }

    fn reply(id: &str, date: i64, to: &str) -> MessageSummary {
        MessageSummary {
            in_reply_to: Some(to.to_owned()),
            ..message(Some(id), date)
        }
    }

    fn with_refs(mut summary: MessageSummary, refs: &[&str]) -> MessageSummary {
        summary.references = refs.iter().map(|r| (*r).to_owned()).collect();
        summary
    }

    fn with_subject(mut summary: MessageSummary, subject: &str) -> MessageSummary {
        subject.clone_into(&mut summary.subject);
        summary
    }

    /// Threads each batch in turn against one index, as successive syncs do.
    fn thread(batches: &[Vec<MessageSummary>]) -> Vec<String> {
        let mut index = ThreadIndex::default();
        batches
            .iter()
            .flat_map(|batch| {
                let items: Vec<_> = batch
                    .iter()
                    .map(|s| (s, format!("INBOX\n{}", s.uid)))
                    .collect();
                assign_threads(&mut index, &items).threads
            })
            .collect()
    }

    #[test]
    fn strips_stacked_reply_and_forward_prefixes() {
        assert_eq!(base_subject("Re: FWD: re:Lunch "), "lunch");
        assert_eq!(base_subject("Lunch"), "lunch");
        assert_eq!(base_subject("Fw : Résumé"), "résumé");
    }

    #[test]
    fn follows_a_reply_chain_to_its_root() {
        assert_eq!(
            thread(&[vec![
                message(Some("a"), 1),
                with_refs(reply("b", 2, "a"), &["a"]),
                with_refs(reply("c", 3, "b"), &["a", "b"]),
            ]]),
            ["a", "a", "a"]
        );
    }

    #[test]
    fn threads_replies_by_in_reply_to_alone() {
        assert_eq!(
            thread(&[
                vec![message(Some("a"), 1)],
                vec![reply("b", 2, "a")],
                vec![reply("c", 3, "b")],
            ]),
            ["a", "a", "a"]
        );
    }

    #[test]
    fn keeps_siblings_together_when_their_parent_was_never_seen() {
        assert_eq!(
            thread(&[
                vec![with_refs(message(Some("b"), 2), &["a"])],
                vec![with_refs(message(Some("c"), 3), &["a"])],
                vec![message(Some("a"), 1)],
            ]),
            ["a", "a", "a"]
        );
    }

    #[test]
    fn threads_a_batch_oldest_first_whatever_order_it_arrives_in() {
        assert_eq!(
            thread(&[vec![
                reply("c", 3, "b"),
                reply("b", 2, "a"),
                message(Some("a"), 1),
            ]]),
            ["a", "a", "a"]
        );
    }

    #[test]
    fn merges_two_conversations_once_a_message_links_them() {
        let mut index = ThreadIndex::default();
        let (c, d) = (reply("c", 3, "b"), reply("d", 4, "a"));
        let first = assign_threads(&mut index, &[(&c, String::new()), (&d, String::new())]);
        assert_eq!(first.threads, ["b", "a"]);
        let b = reply("b", 2, "a");
        let linking = assign_threads(&mut index, &[(&b, String::new())]);
        assert_eq!(linking.threads, ["a"]);
        assert_eq!(linking.merges, [("b".to_owned(), "a".to_owned())]);
        assert_eq!(index.ids.get("c").map(String::as_str), Some("a"));
    }

    #[test]
    fn threads_a_re_without_references_onto_the_conversation_its_subject_started() {
        assert_eq!(
            thread(&[
                vec![message(Some("a"), 1)],
                vec![with_subject(message(Some("b"), 2), "RE: lunch")],
            ]),
            ["a", "a"]
        );
    }

    #[test]
    fn keeps_the_subject_out_of_it_otherwise() {
        assert_eq!(
            thread(&[
                vec![message(Some("a"), 1)],
                vec![message(Some("b"), 2)],
                vec![with_subject(message(Some("c"), 3), "Fwd: Lunch")],
                vec![with_refs(
                    with_subject(message(Some("d"), 4), "Re: Lunch"),
                    &["elsewhere"]
                )],
                vec![with_subject(message(Some("e"), 5), "Re: Dinner")],
            ]),
            ["a", "b", "c", "elsewhere", "e"]
        );
    }

    #[test]
    fn gives_a_message_with_no_ids_a_conversation_of_its_own() {
        assert_eq!(
            thread(&[vec![message(None, 1)], vec![message(None, 2)]]),
            ["INBOX\n1", "INBOX\n2"]
        );
    }

    fn item(mailbox: &str, uid: u32, id: &str) -> StoredMessage {
        StoredMessage {
            account: "a".to_owned(),
            mailbox: mailbox.to_owned(),
            uid_validity: 1,
            uid,
            thread: "x".to_owned(),
            summary: message(Some(id), i64::from(uid)),
        }
    }

    #[test]
    fn lists_the_conversation_oldest_first_once_per_message_without_trash() {
        let first = item("INBOX", 1, "x");
        let mine = item("Sent", 2, "y");
        let to_self = item("INBOX", 3, "y");
        let deleted = item("Trash", 4, "z");
        let latest = item("INBOX", 5, "w");
        let (messages, in_view) = conversation(
            &latest,
            &[
                latest.clone(),
                deleted,
                mine,
                to_self.clone(),
                first.clone(),
            ],
            &["Trash".to_owned()],
        );
        assert_eq!(messages, [first.clone(), to_self.clone(), latest.clone()]);
        assert_eq!(in_view, [first, to_self, latest]);
    }

    #[test]
    fn keeps_trash_messages_when_the_conversation_is_viewed_there() {
        let deleted = item("Trash", 4, "z");
        let (messages, _) = conversation(
            &deleted,
            &[deleted.clone(), item("INBOX", 1, "x")],
            &["Trash".to_owned()],
        );
        assert_eq!(messages.len(), 2);
    }
}
