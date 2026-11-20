import { useEffect } from 'react';
import { createStore, useStore } from 'zustand';

import { accountConfig, accountExists, getAccount } from '@/accounts/store';
import { core, type MailSession } from '@/core';
import { useAppActive } from '@/hooks/use-app-active';
import { isOnline, useOnline } from '@/utils/network';

import { applySync, getKnown, getSyncState, roleMailbox, saveMailboxes } from './db';
import { announceNewMail } from './new-mail';
import { resumePaging } from './paging';
import type { MailboxRef } from './refs';
import { invalidateMail, queryClient } from '@/utils/query-client';
import { withSession } from './session';
import { INBOX } from './view';

export const PAGE_SIZE = 50;
const IDLE_SECONDS = 120;
const MIN_BACKOFF = 2000;
const MAX_BACKOFF = 5 * 60_000;

const syncErrors = createStore<Record<string, unknown>>(() => ({}));

function setSyncError(accountId: string, error: unknown) {
  syncErrors.setState({ [accountId]: error });
}

function clearSyncError(accountId: string) {
  const { [accountId]: _cleared, ...rest } = syncErrors.getState();
  syncErrors.setState(rest, true);
}

export const useSyncErrors = () => useStore(syncErrors);

async function syncWith(session: MailSession, box: MailboxRef) {
  const since = await getSyncState(box);
  const known = since ? await getKnown({ ...box, uidValidity: since.uidValidity }) : [];
  const result = await session.sync(box.mailbox, since, known, PAGE_SIZE);
  // Removed while the server was answering: its data is being deleted, and this would put some back.
  if (!accountExists(box.account)) return;
  await applySync(box, result);
  if (result.reset || result.truncated) resumePaging(box);
  invalidateMail();
  if (box.mailbox !== INBOX || !since || result.reset) return;
  // `changed` also lists old messages whose flags moved; the new ones start at the last known next UID.
  announceNewMail(
    box.account,
    result.changed.filter((message) => message.uid >= since.uidNext && !message.flags.seen),
  );
}

export const syncMailbox = (box: MailboxRef) => withSession(box.account, (session) => syncWith(session, box));

export async function refreshMailboxes(accountId: string) {
  const mailboxes = await withSession(accountId, (s) => s.listMailboxes());
  if (!accountExists(accountId)) return;
  await saveMailboxes(accountId, mailboxes);
  queryClient.invalidateQueries({ queryKey: ['mailboxes', accountId] });
}

const backingOff = new Map<() => void, string>();

// Waits out a failed watcher's backoff, unless retrySync wakes it first.
function backOff(accountId: string, ms: number) {
  return new Promise<void>((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      backingOff.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    backingOff.set(wake, accountId);
  });
}

// Wakes the failed watchers of these accounts now, and resolves once one of them has failed again or recovered.
export function retrySync(accountIds: string[]) {
  const settled = new Promise<void>((resolve) => {
    const stop = syncErrors.subscribe((errors, previous) => {
      if (!accountIds.some((id) => errors[id] !== previous[id])) return;
      stop();
      resolve();
    });
  });
  for (const [wake, accountId] of backingOff) if (accountIds.includes(accountId)) wake();
  return settled;
}

// Syncs the mailbox and waits on IDLE for it, on its own connection, until stopped. The wait compares with
// the session's last sync, so the watched mailbox is synced on the watching session. IDLE can't be
// cancelled: a stop lands when the current wait returns, at most IDLE_SECONDS later.
function watchMailbox(box: MailboxRef) {
  let stopped = false;
  void (async () => {
    let backoff = MIN_BACKOFF;
    while (!stopped) {
      let watcher: MailSession | undefined;
      try {
        await refreshMailboxes(box.account);
        // Sent holds your replies, which join the conversations they answer.
        const sent = await roleMailbox(box.account, 'sent');
        for (const other of [INBOX, sent]) {
          if (other && other !== box.mailbox) await syncMailbox({ account: box.account, mailbox: other });
        }
        watcher = await core.connect(await accountConfig(getAccount(box.account)));
        while (!stopped) {
          await syncWith(watcher, box);
          clearSyncError(box.account);
          backoff = MIN_BACKOFF;
          await watcher.waitForChanges(box.mailbox, IDLE_SECONDS);
        }
      } catch (error) {
        if (stopped) return;
        // Going offline is not a sync failure: the effect below starts a new watcher once the device is back.
        if (!isOnline()) return;
        setSyncError(box.account, error);
        await backOff(box.account, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      } finally {
        await watcher?.logout().catch(() => {});
      }
    }
  })();
  return () => {
    stopped = true;
  };
}

export function useWatchMailbox(account: string, mailbox: string) {
  const active = useAppActive();
  const online = useOnline();
  useEffect(() => {
    if (active && online) return watchMailbox({ account, mailbox });
  }, [account, mailbox, active, online]);
}
