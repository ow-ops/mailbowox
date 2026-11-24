use std::sync::{Arc, Mutex, PoisonError};

use mailbowox_sql::rusqlite::Connection;

use super::{MailStore, SqlRunner};
use crate::types::{
    Address, Cursor, Flags, ListFilter, MailItem, MailboxRef, MessageBody, MessageRef,
    MessageSummary, SyncResult, SyncState,
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

async fn store() -> Arc<MailStore> {
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
    before: Option<&Cursor>,
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
    let cursor = Cursor {
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
    let cursor = Cursor {
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
