use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
};

use mailbowox_sql::rusqlite::Connection;

use super::{MailStore, OlderMail, SqlRunner};
use crate::{
    error::CoreError,
    types::{
        Address, Flags, ListFilter, MailItem, MailboxRef, MessageBody, MessageRef, MessageSummary,
        PageCursor, SearchQuery, StoredMessage, SyncResult, SyncState,
    },
};

/// Answers each batch the way the OPFS worker and the desktop shell do, through the wire format.
struct Wire(Mutex<Connection>);

struct One<'a>(&'a mut Connection);

impl mailbowox_sql::Databases for One<'_> {
    fn connection(&mut self, _: &str) -> Result<&mut Connection, String> {
        Ok(self.0)
    }

    fn remove(&mut self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[async_trait::async_trait]
impl SqlRunner for Wire {
    async fn run(&self, request: Vec<u8>) -> Vec<u8> {
        let mut connection = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        mailbowox_sql::answer(&request, &mut One(&mut connection))
    }
}

pub(super) async fn store() -> Arc<MailStore> {
    let connection = Connection::open_in_memory().expect("a database");
    mailbowox_sql::prepare(&connection, false).expect("prepared");
    MailStore::open_with(
        Arc::new(Wire(Mutex::new(connection))),
        "store.sqlite3".to_owned(),
    )
    .await
    .expect("a store")
}

fn summary(uid: u32, date: i64) -> MessageSummary {
    MessageSummary {
        uid,
        flags: Flags::default(),
        subject: format!("Message {uid}"),
        from: vec![Address {
            name: None,
            email: "sender@example.com".to_owned(),
        }],
        to: Vec::new(),
        cc: Vec::new(),
        reply_to: Vec::new(),
        delivered_to: Vec::new(),
        date,
        message_id: None,
        in_reply_to: None,
        references: Vec::new(),
        preview: String::new(),
        has_attachments: false,
        size: 10,
    }
}

fn seen(mut summary: MessageSummary) -> MessageSummary {
    summary.flags.seen = true;
    summary
}

fn said(uid: u32, date: i64, id: &str, references: &[&str]) -> MessageSummary {
    MessageSummary {
        message_id: Some(id.to_owned()),
        references: references.iter().map(|r| (*r).to_owned()).collect(),
        ..summary(uid, date)
    }
}

fn state(uid_validity: u32, uid_next: u32) -> SyncState {
    SyncState {
        uid_validity,
        uid_next,
        highest_modseq: None,
    }
}

fn sync(
    state: SyncState,
    reset: bool,
    changed: Vec<MessageSummary>,
    vanished: Vec<u32>,
    truncated: bool,
) -> SyncResult {
    SyncResult {
        state,
        reset,
        changed,
        vanished,
        truncated,
    }
}

fn boxed(account: &str, mailbox: &str) -> MailboxRef {
    MailboxRef {
        account: account.to_owned(),
        mailbox: mailbox.to_owned(),
    }
}

fn message(account: &str, mailbox: &str, uid_validity: u32, uid: u32) -> MessageRef {
    MessageRef {
        account: account.to_owned(),
        mailbox: mailbox.to_owned(),
        uid_validity,
        uid,
    }
}

fn body(text: &str) -> MessageBody {
    MessageBody {
        uid: 1,
        html: None,
        text: Some(text.to_owned()),
        has_remote_content: false,
        blocked_remote: 0,
        attachments: Vec::new(),
        list_unsubscribe: Vec::new(),
        list_unsubscribe_one_click: false,
    }
}

async fn uids(store: &MailStore, account: &str, mailbox: &str) -> Vec<u32> {
    page_uids(
        store,
        &[boxed(account, mailbox)],
        None,
        50,
        &ListFilter::default(),
    )
    .await
}

async fn page_uids(
    store: &MailStore,
    boxes: &[MailboxRef],
    before: Option<&PageCursor>,
    limit: u32,
    filter: &ListFilter,
) -> Vec<u32> {
    store
        .page(
            boxes.to_vec(),
            before.cloned(),
            limit,
            false,
            filter.clone(),
        )
        .await
        .expect("a page")
        .into_iter()
        .map(|c| c.latest.uid)
        .collect()
}

#[tokio::test]
async fn keeps_the_first_sync_and_its_state() {
    let store = store().await;
    let first = sync(
        state(1, 10),
        true,
        vec![summary(3, 300), summary(2, 200), summary(1, 100)],
        vec![],
        false,
    );
    store
        .apply_sync("a", "INBOX", &first)
        .await
        .expect("applied");
    assert_eq!(uids(&store, "a", "INBOX").await, [3, 2, 1]);
    assert_eq!(
        store
            .sync_state("a".to_owned(), "INBOX".to_owned())
            .await
            .expect("read"),
        Some(state(1, 10))
    );
}

#[tokio::test]
async fn updates_flags_adds_new_mail_and_drops_vanished_messages_with_their_bodies() {
    let store = store().await;
    let first = sync(
        state(1, 10),
        true,
        vec![summary(3, 300), summary(2, 200), summary(1, 100)],
        vec![],
        false,
    );
    store
        .apply_sync("a", "INBOX", &first)
        .await
        .expect("applied");
    let gone = message("a", "INBOX", 1, 1);
    store
        .save_body(&gone, &body("hi"), false)
        .await
        .expect("saved");
    let next = SyncState {
        highest_modseq: Some(6),
        ..state(1, 11)
    };
    let second = sync(
        next,
        false,
        vec![summary(4, 400), seen(summary(2, 200))],
        vec![1],
        false,
    );
    store
        .apply_sync("a", "INBOX", &second)
        .await
        .expect("applied");

    let page = store
        .page(
            vec![boxed("a", "INBOX")],
            None,
            50,
            false,
            ListFilter::default(),
        )
        .await
        .expect("a page");
    assert_eq!(
        page.iter().map(|c| c.latest.uid).collect::<Vec<_>>(),
        [4, 3, 2]
    );
    assert!(page[2].latest.summary.flags.seen);
    assert_eq!(
        store.cached_body(gone.clone(), false).await.expect("read"),
        None
    );
    assert_eq!(
        store
            .sync_state("a".to_owned(), "INBOX".to_owned())
            .await
            .expect("read"),
        Some(next)
    );
}

#[tokio::test]
async fn a_reset_drops_only_its_mailbox() {
    let store = store().await;
    let archive = sync(state(1, 10), true, vec![summary(9, 50)], vec![], false);
    store
        .apply_sync("a", "Archive", &archive)
        .await
        .expect("applied");
    store
        .apply_sync(
            "a",
            "INBOX",
            &sync(state(1, 10), true, vec![summary(1, 100)], vec![], false),
        )
        .await
        .expect("applied");
    store
        .apply_sync(
            "a",
            "INBOX",
            &sync(state(2, 10), true, vec![summary(1, 500)], vec![], false),
        )
        .await
        .expect("applied");
    assert_eq!(uids(&store, "a", "INBOX").await, [1]);
    assert_eq!(uids(&store, "a", "Archive").await, [9]);
}

#[tokio::test]
async fn a_reused_uid_stays_apart_from_stale_writes() {
    let store = store().await;
    let initial = sync(state(1, 10), true, vec![summary(1, 100)], vec![], false);
    store
        .apply_sync("r", "INBOX", &initial)
        .await
        .expect("applied");
    store
        .apply_sync(
            "r",
            "INBOX",
            &sync(state(2, 10), true, vec![summary(1, 200)], vec![], false),
        )
        .await
        .expect("applied");

    let previous = message("r", "INBOX", 1, 1);
    store
        .remove_messages(vec![previous.clone()])
        .await
        .expect("removed");
    store
        .put_messages(vec![MailItem {
            account: "r".to_owned(),
            mailbox: "INBOX".to_owned(),
            uid_validity: 1,
            summary: summary(1, 100),
        }])
        .await
        .expect("put");
    store
        .add_older("r".to_owned(), "INBOX".to_owned(), 1, vec![summary(2, 50)])
        .await
        .expect("added");
    store
        .save_body(&previous, &body("old"), false)
        .await
        .expect("saved");
    store
        .apply_sync("r", "INBOX", &initial)
        .await
        .expect("applied");

    let page = store
        .page(
            vec![boxed("r", "INBOX")],
            None,
            10,
            false,
            ListFilter::default(),
        )
        .await
        .expect("a page");
    assert_eq!(page.len(), 1);
    assert_eq!(
        (page[0].latest.uid_validity, page[0].latest.summary.date),
        (2, 200)
    );
    assert_eq!(
        store
            .cached_body(previous.clone(), false)
            .await
            .expect("read"),
        None
    );
}

#[tokio::test]
async fn pages_merge_accounts_newest_first_and_continue_after_a_cursor() {
    let store = store().await;
    store
        .apply_sync(
            "a",
            "INBOX",
            &sync(state(1, 10), true, vec![summary(1, 500)], vec![], false),
        )
        .await
        .expect("applied");
    store
        .apply_sync(
            "b",
            "INBOX",
            &sync(
                state(1, 10),
                true,
                vec![summary(7, 450), summary(6, 50)],
                vec![],
                false,
            ),
        )
        .await
        .expect("applied");
    let boxes = [boxed("a", "INBOX"), boxed("b", "INBOX")];
    let first = store
        .page(boxes.to_vec(), None, 2, false, ListFilter::default())
        .await
        .expect("a page");
    let rows: Vec<_> = first
        .iter()
        .map(|c| (c.latest.account.as_str(), c.latest.uid))
        .collect();
    assert_eq!(rows, [("a", 1), ("b", 7)]);
    let last = &first[1].latest;
    let cursor = PageCursor {
        date: last.summary.date,
        account: last.account.clone(),
        uid: last.uid,
    };
    assert_eq!(
        page_uids(&store, &boxes, Some(&cursor), 2, &ListFilter::default()).await,
        [6]
    );
}

#[tokio::test]
async fn a_conversation_shows_once_with_your_sent_reply_in_it() {
    let store = store().await;
    store
        .apply_sync(
            "b",
            "INBOX",
            &sync(
                state(1, 30),
                true,
                vec![
                    said(20, 900, "plan-2", &["plan-1"]),
                    said(10, 700, "plan-1", &[]),
                ],
                vec![],
                false,
            ),
        )
        .await
        .expect("applied");
    store
        .apply_sync(
            "b",
            "Sent",
            &sync(
                state(1, 10),
                true,
                vec![said(1, 800, "mine", &["plan-1"])],
                vec![],
                false,
            ),
        )
        .await
        .expect("applied");
    let rows = store
        .page(
            vec![boxed("b", "INBOX")],
            None,
            50,
            true,
            ListFilter::default(),
        )
        .await
        .expect("a page");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].latest.uid, 20);
    let mut members: Vec<_> = rows[0]
        .messages
        .iter()
        .map(|m| (m.mailbox.as_str(), m.uid))
        .collect();
    members.sort_unstable();
    assert_eq!(members, [("INBOX", 10), ("INBOX", 20), ("Sent", 1)]);
}

#[tokio::test]
async fn a_sync_that_left_mail_out_lists_down_to_the_gap_until_paging_fills_it() {
    let store = store().await;
    store
        .apply_sync(
            "g",
            "INBOX",
            &sync(
                state(1, 4),
                true,
                vec![summary(3, 300), summary(2, 200), summary(1, 100)],
                vec![],
                false,
            ),
        )
        .await
        .expect("applied");
    store
        .apply_sync(
            "g",
            "INBOX",
            &sync(
                state(1, 104),
                false,
                vec![
                    summary(103, 10300),
                    summary(102, 10200),
                    seen(summary(2, 200)),
                ],
                vec![],
                true,
            ),
        )
        .await
        .expect("applied");
    assert_eq!(uids(&store, "g", "INBOX").await, [103, 102]);
    let mut known: Vec<u32> = store
        .known("g", "INBOX", 1)
        .await
        .expect("known")
        .iter()
        .map(|k| k.uid)
        .collect();
    known.sort_unstable();
    assert_eq!(known, [1, 2, 3, 102, 103]);

    store
        .add_older(
            "g".to_owned(),
            "INBOX".to_owned(),
            1,
            vec![summary(101, 10100), summary(4, 400)],
        )
        .await
        .expect("added");
    store
        .add_older("g".to_owned(), "INBOX".to_owned(), 1, vec![summary(3, 300)])
        .await
        .expect("added");
    assert_eq!(uids(&store, "g", "INBOX").await, [103, 102, 101, 4, 3]);
}

#[tokio::test]
async fn a_conversation_with_nothing_left_is_forgotten_and_one_that_lost_a_message_keeps_its_replies()
 {
    let store = store().await;
    let changed = vec![
        said(3, 300, "kept-2", &["kept-1"]),
        said(2, 200, "kept-1", &[]),
        said(1, 100, "gone-1", &[]),
    ];
    store
        .apply_sync(
            "t",
            "INBOX",
            &sync(state(1, 10), true, changed, vec![], false),
        )
        .await
        .expect("applied");
    store
        .remove_messages(vec![
            message("t", "INBOX", 1, 1),
            message("t", "INBOX", 1, 2),
        ])
        .await
        .expect("removed");
    store
        .apply_sync(
            "t",
            "INBOX",
            &sync(
                state(1, 10),
                false,
                vec![said(4, 400, "kept-3", &["kept-1", "kept-2"])],
                vec![],
                false,
            ),
        )
        .await
        .expect("applied");
    let rows = store
        .page(
            vec![boxed("t", "INBOX")],
            None,
            50,
            true,
            ListFilter::default(),
        )
        .await
        .expect("a page");
    assert_eq!(rows.len(), 1);
    let mut members: Vec<u32> = rows[0].messages.iter().map(|m| m.uid).collect();
    members.sort_unstable();
    assert_eq!(members, [3, 4]);
}

#[tokio::test]
async fn filters_keep_only_what_they_ask_for() {
    let store = store().await;
    let mut unread = summary(1, 100);
    unread.flags.seen = false;
    let mut flagged = seen(summary(2, 200));
    flagged.flags.flagged = true;
    let mut attached = seen(summary(3, 300));
    attached.has_attachments = true;
    let mut to_me = seen(summary(4, 400));
    to_me.to = vec![Address {
        name: None,
        email: "Me@Example.com".to_owned(),
    }];
    let mut cc_me = seen(summary(5, 500));
    cc_me.cc = vec![Address {
        name: Some("Me".to_owned()),
        email: "me@example.com".to_owned(),
    }];
    let changed = vec![
        unread,
        flagged,
        attached,
        to_me,
        cc_me,
        seen(summary(6, 600)),
    ];
    store
        .apply_sync(
            "f",
            "INBOX",
            &sync(state(1, 10), true, changed, vec![], false),
        )
        .await
        .expect("applied");

    let inbox = [boxed("f", "INBOX")];
    let listed = |filter: ListFilter| {
        let store = store.clone();
        let inbox = inbox.clone();
        async move { page_uids(&store, &inbox, None, 50, &filter).await }
    };
    let me = vec!["me@example.com".to_owned()];
    assert_eq!(listed(ListFilter::default()).await, [6, 5, 4, 3, 2, 1]);
    assert_eq!(
        listed(ListFilter {
            unread: true,
            ..ListFilter::default()
        })
        .await,
        [1]
    );
    assert_eq!(
        listed(ListFilter {
            flagged: true,
            ..ListFilter::default()
        })
        .await,
        [2]
    );
    assert_eq!(
        listed(ListFilter {
            attachments: true,
            ..ListFilter::default()
        })
        .await,
        [3]
    );
    let to_me = ListFilter {
        to_me: true,
        me,
        ..ListFilter::default()
    };
    assert_eq!(listed(to_me.clone()).await, [5, 4]);
    assert_eq!(
        listed(ListFilter {
            unread: true,
            ..to_me.clone()
        })
        .await,
        Vec::<u32>::new()
    );
    let grouped = store
        .page(inbox.to_vec(), None, 50, true, to_me.clone())
        .await
        .expect("a page");
    assert_eq!(
        grouped.iter().map(|c| c.latest.uid).collect::<Vec<_>>(),
        [5, 4]
    );
}

#[tokio::test]
async fn keeps_the_last_body_read_and_counts_what_it_blocked() {
    let store = store().await;
    store
        .apply_sync(
            "a",
            "INBOX",
            &sync(state(1, 10), true, vec![summary(1, 100)], vec![], false),
        )
        .await
        .expect("applied");
    let r = message("a", "INBOX", 1, 1);
    assert_eq!(store.blocked_count(r.clone()).await.expect("read"), None);
    let blocked = MessageBody {
        blocked_remote: 3,
        has_remote_content: true,
        ..body("x")
    };
    store.save_body(&r, &blocked, false).await.expect("saved");
    assert_eq!(store.blocked_count(r.clone()).await.expect("read"), Some(3));
    assert_eq!(
        store.cached_body(r.clone(), false).await.expect("read"),
        Some(blocked)
    );
    // Fetched without remote content, so it does not answer a request that allows it.
    assert_eq!(
        store.cached_body(r.clone(), true).await.expect("read"),
        None
    );
}

#[tokio::test]
async fn an_account_s_data_is_listed_until_it_is_deleted() {
    let store = store().await;
    store
        .apply_sync(
            "leaving",
            "INBOX",
            &sync(state(1, 2), true, vec![summary(1, 100)], vec![], false),
        )
        .await
        .expect("applied");
    assert!(
        store
            .stored_accounts()
            .await
            .expect("read")
            .contains(&"leaving".to_owned())
    );
    store
        .delete_account("leaving".to_owned())
        .await
        .expect("deleted");
    assert!(
        !store
            .stored_accounts()
            .await
            .expect("read")
            .contains(&"leaving".to_owned())
    );
}

#[tokio::test]
async fn the_conversations_query_walks_the_date_index_without_sorting_the_mailbox() {
    let store = store().await;
    let cursor = PageCursor {
        date: 0,
        account: "a".to_owned(),
        uid: 0,
    };
    let page = super::list::conversations_page(
        &[boxed("a", "INBOX")],
        Some(&cursor),
        50,
        &ListFilter::default(),
    )
    .expect("a statement");
    let plan = store
        .exec
        .batch(vec![mailbowox_sql::Statement {
            sql: format!("EXPLAIN QUERY PLAN {}", page.sql),
            params: page.params,
        }])
        .await
        .expect("a plan");
    let steps: Vec<&str> = plan[0]
        .iter()
        .filter_map(|row| row.get(3)?.as_str())
        .collect();
    let steps = steps.join("\n");
    assert!(steps.contains("messages_by_date"), "{steps}");
    assert!(steps.contains("messages_by_thread"), "{steps}");
    assert!(!steps.contains("TEMP B-TREE"), "{steps}");
}

#[tokio::test]
async fn a_native_store_keeps_its_file() {
    let dir = std::env::temp_dir().join(format!("mailbowox-store-{}", uuid::Uuid::new_v4()));
    let path = dir
        .join("SQLite")
        .join("store.sqlite3")
        .to_string_lossy()
        .into_owned();
    let store = MailStore::open(path.clone()).await.expect("a store");
    store
        .apply_sync(
            "a",
            "INBOX",
            &sync(state(1, 2), true, vec![summary(1, 100)], vec![], false),
        )
        .await
        .expect("applied");
    drop(store);
    let again = MailStore::open(path).await.expect("reopened");
    assert_eq!(uids(&again, "a", "INBOX").await, [1]);
    let _ = std::fs::remove_dir_all(dir);
}

/// The server's whole mailbox per account, newest first, handed out a few at a time.
struct Server {
    mail: HashMap<String, Vec<MessageSummary>>,
    per_fetch: usize,
}

#[async_trait::async_trait]
impl OlderMail for Server {
    async fn fetch_older(
        &self,
        before: MessageRef,
        _limit: u32,
    ) -> Result<Vec<MessageSummary>, CoreError> {
        Ok(self.mail.get(&before.account).map_or_default(|all| {
            all.iter()
                .filter(|s| s.uid < before.uid)
                .take(self.per_fetch)
                .cloned()
                .collect()
        }))
    }
}

async fn page_all(
    store: &MailStore,
    boxes: &[MailboxRef],
    grouped: bool,
    server: Arc<Server>,
) -> Vec<Vec<StoredMessage>> {
    let limit = 6;
    let mut pages = Vec::new();
    let mut cursor = None;
    loop {
        let page: Vec<StoredMessage> = store
            .load_page(
                boxes.to_vec(),
                cursor.clone(),
                limit,
                grouped,
                ListFilter::default(),
                server.clone(),
            )
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.latest)
            .collect();
        // A short page is not the end: the list ends with the page that comes back empty.
        cursor = page.last().map(|last| PageCursor {
            date: last.summary.date,
            account: last.account.clone(),
            uid: last.uid,
        });
        if page.is_empty() {
            return pages;
        }
        pages.push(page);
    }
}

fn mailbox_of(
    count: u32,
    offset: i64,
    thread: impl Fn(u32) -> Option<&'static str>,
) -> Vec<MessageSummary> {
    (1..=count)
        .rev()
        .map(|uid| {
            let date = i64::from(uid) * 10 + offset;
            let id = format!("m-{uid}-{date}");
            let references: Vec<&str> = thread(uid).into_iter().collect();
            said(uid, date, &id, &references)
        })
        .collect()
}

/// Two accounts whose mail interleaves; the server holds 30 messages each and sync kept the newest 5.
async fn two_accounts(
    store: &MailStore,
    alice: &str,
    bob: &str,
    thread: impl Fn(u32) -> Option<&'static str>,
) -> Arc<Server> {
    let mut mail = HashMap::new();
    for (account, all) in [
        (alice, mailbox_of(30, 0, &thread)),
        (bob, mailbox_of(30, 5, |_| None)),
    ] {
        let newest = all.iter().take(5).cloned().collect();
        store
            .apply_sync(
                account,
                "INBOX",
                &sync(state(1, 31), true, newest, vec![], false),
            )
            .await
            .unwrap();
        mail.insert(account.to_owned(), all);
    }
    Arc::new(Server { mail, per_fetch: 2 })
}

#[tokio::test]
async fn paging_fetches_through_a_gap_and_on_to_the_older_mail() {
    let store = store().await;
    let server = mailbox_of(12, 0, |_| None);
    store
        .apply_sync(
            "gap",
            "INBOX",
            &sync(
                state(1, 4),
                true,
                server.iter().skip(9).cloned().collect(),
                vec![],
                false,
            ),
        )
        .await
        .unwrap();
    // Nine more arrived and the sync brought the newest two: 4 to 10 are on the server only.
    store
        .apply_sync(
            "gap",
            "INBOX",
            &sync(
                state(1, 13),
                false,
                server.iter().take(2).cloned().collect(),
                vec![],
                true,
            ),
        )
        .await
        .unwrap();
    let older = Arc::new(Server {
        mail: HashMap::from([("gap".to_owned(), server)]),
        per_fetch: 3,
    });
    let uids: Vec<u32> = page_all(&store, &[boxed("gap", "INBOX")], false, older)
        .await
        .concat()
        .iter()
        .map(|m| m.uid)
        .collect();
    assert_eq!(uids, (1..=12).rev().collect::<Vec<_>>());
}

#[tokio::test]
async fn paging_two_accounts_lists_every_message_once_newest_first() {
    let store = store().await;
    let server = two_accounts(&store, "alice", "bob", |_| None).await;
    let pages = page_all(
        &store,
        &[boxed("alice", "INBOX"), boxed("bob", "INBOX")],
        false,
        server,
    )
    .await;
    let dates: Vec<i64> = pages.concat().iter().map(|m| m.summary.date).collect();
    assert_eq!(dates.len(), 60);
    assert!(dates.is_sorted_by(|a, b| a >= b), "{dates:?}");
    assert!(pages.iter().rev().skip(1).all(|page| page.len() == 6));
}

#[tokio::test]
async fn paging_keeps_conversations_in_date_order_when_one_account_is_mostly_one_thread() {
    let store = store().await;
    // Alice's messages 5 to 20 all answer one conversation, so a batch of them adds a single row.
    let server = two_accounts(&store, "alice-t", "bob-t", |uid| {
        (5..=20).contains(&uid).then_some("long")
    })
    .await;
    let rows = page_all(
        &store,
        &[boxed("alice-t", "INBOX"), boxed("bob-t", "INBOX")],
        true,
        server,
    )
    .await
    .concat();
    let dates: Vec<i64> = rows.iter().map(|m| m.summary.date).collect();
    assert!(dates.is_sorted_by(|a, b| a >= b), "{dates:?}");
    assert_eq!(rows.iter().filter(|m| m.account == "bob-t").count(), 30);
    assert_eq!(
        rows.iter().filter(|m| m.account == "alice-t").count(),
        30 - 15
    );
}

fn search_query(terms: &[&str]) -> SearchQuery {
    SearchQuery {
        terms: terms.iter().map(|t| (*t).to_owned()).collect(),
        ..SearchQuery::default()
    }
}

async fn found(store: &MailStore, boxes: &[MailboxRef], query: SearchQuery) -> Vec<(String, u32)> {
    store
        .search(boxes.to_vec(), query, 50)
        .await
        .unwrap()
        .into_iter()
        .map(|m| (m.mailbox, m.uid))
        .collect()
}

fn with(mut summary: MessageSummary, change: impl FnOnce(&mut MessageSummary)) -> MessageSummary {
    change(&mut summary);
    summary
}

#[tokio::test]
async fn search_finds_every_word_across_subject_people_and_preview_newest_first() {
    let store = store().await;
    let elise = Address {
        name: Some("Élise Martin".to_owned()),
        email: "elise@shop.example".to_owned(),
    };
    let inbox = vec![
        with(summary(52, 520), |s| {
            "Invoice for March".clone_into(&mut s.subject);
            s.from = vec![elise];
        }),
        with(summary(51, 510), |s| {
            "the invoice is attached".clone_into(&mut s.preview);
        }),
        with(summary(50, 500), |s| {
            s.to = vec![Address {
                name: None,
                email: "team@example.com".to_owned(),
            }];
        }),
    ];
    store
        .apply_sync(
            "a",
            "INBOX",
            &sync(state(1, 100), true, inbox, vec![], false),
        )
        .await
        .unwrap();
    let archive = vec![with(summary(9, 90), |s| {
        "Old invoice".clone_into(&mut s.subject);
    })];
    store
        .apply_sync(
            "a",
            "Archive",
            &sync(state(1, 100), true, archive, vec![], false),
        )
        .await
        .unwrap();
    let both = [boxed("a", "INBOX"), boxed("a", "Archive")];
    let at = |mailbox: &str, uid| (mailbox.to_owned(), uid);

    assert_eq!(
        found(&store, &both, search_query(&["invoice"])).await,
        [at("INBOX", 52), at("INBOX", 51), at("Archive", 9)]
    );
    assert_eq!(
        found(&store, &both, search_query(&["elise", "invoice"])).await,
        [at("INBOX", 52)]
    );
    assert_eq!(
        found(&store, &both, search_query(&["team@example"])).await,
        [at("INBOX", 50)]
    );
    assert_eq!(
        found(&store, &both, search_query(&["invoice", "holiday"])).await,
        []
    );
    assert_eq!(
        found(&store, &[boxed("a", "Archive")], search_query(&["invoice"])).await,
        [at("Archive", 9)]
    );

    // Found by a search below the list, it stays out of the list until paging reaches it.
    store
        .put_messages(vec![MailItem {
            account: "a".to_owned(),
            mailbox: "INBOX".to_owned(),
            uid_validity: 1,
            summary: with(summary(3, 30), |s| {
                "Ancient invoice".clone_into(&mut s.subject);
            }),
        }])
        .await
        .unwrap();
    assert_eq!(
        found(&store, &[boxed("a", "INBOX")], search_query(&["ancient"])).await,
        [at("INBOX", 3)]
    );
    assert_eq!(uids(&store, "a", "INBOX").await, [52, 51, 50]);
    store
        .add_older(
            "a".to_owned(),
            "INBOX".to_owned(),
            1,
            vec![summary(10, 100), summary(3, 30)],
        )
        .await
        .unwrap();
    assert_eq!(uids(&store, "a", "INBOX").await, [52, 51, 50, 10, 3]);
}

#[tokio::test]
async fn search_filters_on_flags_and_attachments_and_widens_for_fields() {
    let store = store().await;
    let changed = vec![
        with(summary(3, 300), |s| {
            s.has_attachments = true;
            s.flags.flagged = true;
            s.flags.seen = true;
        }),
        with(summary(2, 200), |s| "invoice".clone_into(&mut s.preview)),
        with(summary(1, 100), |s| s.flags.seen = true),
    ];
    store
        .apply_sync(
            "o",
            "INBOX",
            &sync(state(1, 10), true, changed, vec![], false),
        )
        .await
        .unwrap();
    let inbox = [boxed("o", "INBOX")];
    let uids_for = |query: SearchQuery| {
        let (store, inbox) = (store.clone(), inbox.clone());
        async move {
            found(&store, &inbox, query)
                .await
                .into_iter()
                .map(|(_, uid)| uid)
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(
        uids_for(SearchQuery {
            seen: Some(false),
            ..SearchQuery::default()
        })
        .await,
        [2]
    );
    assert_eq!(
        uids_for(SearchQuery {
            seen: Some(true),
            ..SearchQuery::default()
        })
        .await,
        [3, 1]
    );
    assert_eq!(
        uids_for(SearchQuery {
            flagged: true,
            ..SearchQuery::default()
        })
        .await,
        [3]
    );
    assert_eq!(
        uids_for(SearchQuery {
            attachments: true,
            ..SearchQuery::default()
        })
        .await,
        [3]
    );

    // A field's value only narrows here, so more candidates than a page come back for the app to check.
    let crowded: Vec<MessageSummary> = (100..160)
        .map(|uid| {
            with(summary(uid, i64::from(uid)), |s| {
                "About elise".clone_into(&mut s.subject);
            })
        })
        .collect();
    store
        .apply_sync(
            "c",
            "INBOX",
            &sync(state(1, 200), true, crowded, vec![], false),
        )
        .await
        .unwrap();
    let narrow = store
        .search(vec![boxed("c", "INBOX")], search_query(&["elise"]), 50)
        .await
        .unwrap();
    let wide = store
        .search(
            vec![boxed("c", "INBOX")],
            SearchQuery {
                fields: true,
                ..search_query(&["elise"])
            },
            50,
        )
        .await
        .unwrap();
    assert_eq!((narrow.len(), wide.len()), (50, 60));
}
