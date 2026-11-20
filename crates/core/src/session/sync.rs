//! What changed in a mailbox since the caller last looked.

use std::{
    collections::{BTreeMap, HashMap},
    num::{NonZeroU32, NonZeroU64},
};

use io_imap::{rfc3501::select::ImapMailboxSelectData, types::command::SelectParameter};

use super::{Inner, condstore_parameters, fetch_flags, fetch_summaries, state_of, summaries};
use crate::{
    error::CoreError,
    imap::{ImapConn, range_set},
    summary::uid_of,
    types::{Flags, KnownMessage, SyncResult, SyncState},
};

impl Inner {
    pub(super) async fn select_state(&mut self, mailbox: &str) -> Result<SyncState, CoreError> {
        let parameters = condstore_parameters(&self.conn);
        let selected = self.conn.select(mailbox, parameters).await?;
        Ok(state_of(&selected))
    }

    pub(super) async fn sync(
        &mut self,
        mailbox: &str,
        since: Option<SyncState>,
        known: &[KnownMessage],
        limit: u32,
    ) -> Result<SyncResult, CoreError> {
        let resume = since.filter(|_| self.conn.qresync()).and_then(|since| {
            Some(SelectParameter::QResync {
                uid_validity: NonZeroU32::new(since.uid_validity)?,
                mod_sequence_value: NonZeroU64::new(since.highest_modseq?)?,
                known_uids: None,
                seq_match_data: None,
            })
        });
        let qresync = resume.is_some();
        let parameters = match resume {
            Some(resume) => vec![resume],
            None => condstore_parameters(&self.conn),
        };
        let selected = self.conn.select(mailbox, parameters).await?;
        let state = state_of(&selected);
        if state.uid_validity == 0 {
            return Err(CoreError::protocol("the server omitted UIDVALIDITY"));
        }
        let since = since.filter(|since| since.uid_validity == state.uid_validity);

        let Some(since) = since else {
            return reset(&mut self.conn, &selected, state, limit).await;
        };
        if qresync {
            return self
                .qresync_delta(&selected, state, since, known, limit)
                .await;
        }

        // Only the cached messages and the new ones matter, so the listing starts at the oldest of them.
        let first = known
            .iter()
            .map(|message| message.uid)
            .min()
            .map_or(since.uid_next, |oldest| oldest.min(since.uid_next));
        let current = fetch_flags(&mut self.conn, range_set(first, None)).await?;
        let delta = diff(known, &current, since.uid_next, limit);
        Ok(SyncResult {
            state,
            reset: false,
            changed: summaries(&mut self.conn, &delta.wanted).await?,
            vanished: delta.vanished,
            truncated: delta.truncated,
        })
    }

    async fn qresync_delta(
        &mut self,
        selected: &ImapMailboxSelectData,
        state: SyncState,
        since: SyncState,
        known: &[KnownMessage],
        limit: u32,
    ) -> Result<SyncResult, CoreError> {
        // The server may name ranges far wider than the mailbox ever was, so they are matched against
        // the cached UIDs rather than expanded.
        let vanished = known
            .iter()
            .map(|message| message.uid)
            .filter(|uid| {
                selected
                    .vanished_earlier
                    .iter()
                    .any(|range| (range.start().get()..=range.end().get()).contains(uid))
            })
            .collect();

        let mut new = BTreeMap::new();
        if state.uid_next > since.uid_next {
            new = fetch_flags(&mut self.conn, range_set(since.uid_next, None)).await?;
            // `n:*` always names the last message, even one below `n`.
            new.retain(|&uid, _| uid >= since.uid_next);
        }
        let new: Vec<u32> = new.into_keys().collect();
        let old = selected
            .changed
            .iter()
            .filter_map(|fetch| uid_of(fetch.items.as_ref()))
            .filter(|&uid| uid < since.uid_next);
        let wanted: Vec<u32> = old.chain(newest(&new, limit)).collect();

        Ok(SyncResult {
            state,
            reset: false,
            changed: summaries(&mut self.conn, &wanted).await?,
            vanished,
            truncated: new.len() > limit as usize,
        })
    }
}

async fn reset(
    conn: &mut ImapConn,
    selected: &ImapMailboxSelectData,
    state: SyncState,
    limit: u32,
) -> Result<SyncResult, CoreError> {
    let exists = selected.exists.unwrap_or(0);
    let first = exists.saturating_sub(limit.saturating_sub(1)).max(1);
    let changed = match range_set(first, Some(exists)).filter(|_| limit > 0) {
        Some(set) => fetch_summaries(conn, set, false).await?,
        None => Vec::new(),
    };
    Ok(SyncResult {
        state,
        reset: true,
        changed,
        vanished: Vec::new(),
        truncated: false,
    })
}

struct Delta {
    vanished: Vec<u32>,
    wanted: Vec<u32>,
    truncated: bool,
}

/// What the server's `current` listing changes for a caller that has `known`
/// cached: the known UIDs that are gone, and the UIDs to summarise, which
/// are every known message whose flags moved plus the newest `limit` of those
/// from `uid_next` on. A message that is neither known nor new is one the
/// caller never loaded, and stays out.
fn diff(
    known: &[KnownMessage],
    current: &BTreeMap<u32, Flags>,
    uid_next: u32,
    limit: u32,
) -> Delta {
    let vanished = known
        .iter()
        .map(|message| message.uid)
        .filter(|uid| !current.contains_key(uid))
        .collect();
    let known: HashMap<u32, Flags> = known
        .iter()
        .map(|message| (message.uid, message.flags))
        .collect();
    let old = current
        .iter()
        .filter(|(uid, flags)| known.get(uid).is_some_and(|cached| cached != *flags))
        .map(|(&uid, _)| uid);
    let new: Vec<u32> = current
        .keys()
        .copied()
        .filter(|uid| *uid >= uid_next && !known.contains_key(uid))
        .collect();
    Delta {
        vanished,
        wanted: old.chain(newest(&new, limit)).collect(),
        truncated: new.len() > limit as usize,
    }
}

fn newest(sorted_uids: &[u32], limit: u32) -> impl Iterator<Item = u32> + '_ {
    sorted_uids.iter().rev().take(limit as usize).copied()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::diff;
    use crate::types::{Flags, KnownMessage};

    #[test]
    fn diff_reports_removed_changed_and_newest_new_uids() {
        let seen = Flags {
            seen: true,
            ..Flags::default()
        };
        let known = [(2, seen), (3, seen), (4, Flags::default())]
            .map(|(uid, flags)| KnownMessage { uid, flags });
        // 1 was never loaded; 3 is gone; 4 was read; 5 to 7 are new.
        let current = BTreeMap::from([
            (1, Flags::default()),
            (2, seen),
            (4, seen),
            (5, Flags::default()),
            (6, Flags::default()),
            (7, Flags::default()),
        ]);

        let delta = diff(&known, &current, 5, 2);
        assert_eq!(delta.vanished, [3]);
        assert_eq!(delta.wanted, [4, 7, 6]);
        assert!(delta.truncated);
        assert!(!diff(&known, &current, 5, 3).truncated);
    }
}
