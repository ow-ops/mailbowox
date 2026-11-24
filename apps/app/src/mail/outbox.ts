import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createStore, useStore } from 'zustand';

import { getAccount } from '@/accounts/store';
import type { Draft } from '@/core';
import { useAppActive } from '@/hooks/use-app-active';
import { isOnline, useOnline } from '@/utils/network';

import { coreErrorKind, isUnconfirmed, restoreError, storeError } from '@/core/errors';
import { invalidateMail } from '@/utils/query-client';
import { deliver } from './send';
import { mailStore } from './store';
import { useSyncErrors } from './sync';

const FIRST_RETRY = 30_000;
const LAST_RETRY = 10 * 60_000;

export const useQueuedMessages = () =>
  useQuery({ queryKey: ['outbox'], queryFn: async () => (await mailStore()).queuedMessages() });

const sending = createStore<{ id: number | null }>(() => ({ id: null }));

// The message on its way to the server can no longer be cancelled.
export const useSendingId = () => useStore(sending, (state) => state.id);

const held = createStore<{ ids: number[] }>(() => ({ ids: [] }));

export const useHeldIds = () => useStore(held, (state) => state.ids);

const letGo = (id: number) => held.setState({ ids: held.getState().ids.filter((other) => other !== id) });

// Queues a message that flushOutbox passes over until it is released. It is in the outbox from the start,
// so if the app stops meanwhile the next start sends it.
export async function holdMessage(account: string, draft: Draft) {
  const id = await (await mailStore()).enqueue(account, draft, null);
  held.setState({ ids: [...held.getState().ids, id] });
  invalidateMail();
  return id;
}

export async function releaseMessage(id: number) {
  letGo(id);
  // A run already going may have passed over it.
  await flushing;
  await flushOutbox();
}

export async function cancelQueued(id: number) {
  await (await mailStore()).removeQueued(id);
  letGo(id);
  invalidateMail();
}

// Marks a message before each attempt: if the app stops before the server answers, the message waits for the user,
// since the server may already have it.
const INTERRUPTED = storeError({ tag: 'Unconfirmed', message: 'the app stopped before the server answered' });

const unconfirmed = (error: string | null) => !!error && isUnconfirmed(restoreError(error));

let flushing: Promise<void> | undefined;

// Sends oldest first. Losing the connection stops the run; the rest stay queued. A message the server
// rejects keeps its error and doesn't block the others. One that may have gone out is never resent without
// the user.
export function flushOutbox() {
  flushing ??= run().finally(() => {
    flushing = undefined;
  });
  return flushing;
}

async function run() {
  const store = await mailStore();
  for (const { id } of await store.queuedMessages()) {
    if (!isOnline()) return;
    // Read again: the user may have cancelled it while an earlier message was sending.
    const queued = await store.queuedMessage(id);
    if (!queued || unconfirmed(queued.error) || held.getState().ids.includes(id)) continue;
    sending.setState({ id });
    let sent = false;
    try {
      const attachments = await store.queuedAttachments(id);
      await store.setQueuedError(id, INTERRUPTED);
      await deliver(getAccount(queued.account), { ...queued.draft, attachments });
      sent = true;
    } catch (error) {
      if (coreErrorKind(error) === 'unreachable') {
        await store.setQueuedError(id, queued.error);
        return;
      }
      await store.setQueuedError(id, storeError(error));
    } finally {
      sending.setState({ id: null });
    }
    // Outside the try: failing to remove a message that went out must not record it as a failed send. It stays
    // marked as interrupted, for the user to decide.
    if (sent) await store.removeQueued(id);
    invalidateMail();
  }
}

// For a message whose sending went unconfirmed, once the user has checked it didn't arrive.
export async function sendAgain(id: number) {
  await (await mailStore()).setQueuedError(id, null);
  invalidateMail();
  // A run already going may have passed over it.
  await flushing;
  await flushOutbox();
}

// Flushes when the app comes online or foregrounds, when the queue changes, when a failing mailbox sync
// recovers, and on a backoff timer while messages stay queued (the server may be down while the network is
// fine).
export function useFlushOutbox() {
  const active = useAppActive();
  const online = useOnline();
  const queued = useQueuedMessages().data?.length ?? 0;
  const failingSyncs = Object.keys(useSyncErrors()).length;
  useEffect(() => {
    if (!active || !online || !queued) return;
    let stopped = false;
    let delay = FIRST_RETRY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () =>
      void flushOutbox().finally(() => {
        if (stopped) return;
        timer = setTimeout(attempt, delay);
        delay = Math.min(delay * 2, LAST_RETRY);
      });
    attempt();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, online, queued, failingSyncs]);
}
