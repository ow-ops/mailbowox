import { useMutation } from '@tanstack/react-query';

import type { MailSession } from '@/core';
import { t } from '@/i18n';
import { confirmAction } from '@/utils/dialog';
import { showError, showToast } from '@/utils/toast';

import { getMailboxes, putMessages, removeMessages, roleMailbox } from './db';
import type { MailboxGeneration, MailItem } from './refs';
import { explainError } from '@/core/errors';
import { mailboxLabel } from './mailboxes';
import { invalidateMail } from '@/utils/query-client';
import { useRoleMailbox } from './queries';
import { seenChange } from './selection';
import { withSession } from './session';
import { refreshMailboxes } from './sync';
import type { Conversation } from './threads';

type FlagChange = { items: MailItem[]; flag: 'seen' | 'flagged'; value: boolean };

type Group = MailboxGeneration & { items: MailItem[] };

function byMailbox(items: MailItem[]) {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const { account, mailbox, uidValidity } = item;
    const key = JSON.stringify([account, mailbox, uidValidity]);
    const group = groups.get(key) ?? { account, mailbox, uidValidity, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function perMailbox(
  items: MailItem[],
  run: (session: MailSession, mailbox: string, uidValidity: number, uids: number[]) => Promise<void>,
) {
  for (const group of byMailbox(items)) {
    await withSession(group.account, (s) => run(s, group.mailbox, group.uidValidity, group.items.map((item) => item.uid)));
  }
}

// Local changes land in sqlite before the server call; a failure puts the messages back as they were.
export function useSetFlag() {
  return useMutation({
    mutationFn: ({ items, flag, value }: FlagChange) =>
      perMailbox(items, (s, mailbox, uidValidity, uids) =>
        s.setFlags(mailbox, uidValidity, uids, value ? { [flag]: true } : {}, value ? {} : { [flag]: true }),
      ),
    onMutate: async ({ items, flag, value }) => {
      await putMessages(
        items.map((item) => ({ ...item, summary: { ...item.summary, flags: { ...item.summary.flags, [flag]: value } } })),
      );
      invalidateMail();
    },
    onError: async (_error, { items }) => {
      await putMessages(items);
      invalidateMail();
    },
  });
}

// Archive and Trash resolve per account. Without an archive mailbox, archiving creates one named Archive; without
// Trash, or from Trash itself, deleting is for good.
export type Destination = 'archive' | 'trash' | { mailbox: string };

async function createArchive(account: string) {
  await withSession(account, (s) => s.createMailbox('Archive'));
  await refreshMailboxes(account);
  return 'Archive';
}

async function resolve(destination: Destination, { account, mailbox }: Group) {
  if (typeof destination === 'object') return destination.mailbox;
  const found = await roleMailbox(account, destination);
  if (destination === 'archive') return found ?? (await createArchive(account));
  return found && found !== mailbox ? found : null;
}

// Whether deleting any of the items would be for good, so it needs confirming first.
async function deletesForGood(items: MailItem[]) {
  const groups = byMailbox(items);
  const trash = await Promise.all(groups.map((group) => roleMailbox(group.account, 'trash')));
  return groups.some((group, i) => !trash[i] || trash[i] === group.mailbox);
}

type Moved = Group & { destination: string; copied: Awaited<ReturnType<MailSession['moveMessages']>> };

async function moveAll(items: MailItem[], destination: Destination) {
  const moved: Moved[] = [];
  for (const group of byMailbox(items)) {
    const target = await resolve(destination, group);
    const uids = group.items.map((item) => item.uid);
    await withSession(group.account, async (s) => {
      if (target === null) return s.deleteMessages(group.mailbox, group.uidValidity, uids);
      const copied = await s.moveMessages(group.mailbox, group.uidValidity, uids, target);
      moved.push({ ...group, destination: target, copied });
    });
  }
  return moved;
}

// The moved messages get new UIDs both ways, so they come back under the UIDs the server reports.
async function moveBack(moved: Moved[]) {
  for (const { account, mailbox, destination, items, copied } of moved) {
    if (!copied) continue;
    const back = await withSession(account, (s) => s.moveMessages(destination, copied.uidValidity, copied.uids, mailbox));
    if (!back) continue;
    await putMessages(
      back.uids.map((uid, i) => ({ ...items[i], uid, uidValidity: back.uidValidity, summary: { ...items[i].summary, uid } })),
    );
  }
  invalidateMail();
}

const undoable = (moved: Moved[]) =>
  moved.length > 0 && moved.every(({ items, copied }) => copied?.uids.length === items.length);

async function movedLabel(destination: Destination, account: string) {
  if (destination === 'archive') return t('mail.actions.archived');
  if (destination === 'trash') return t('mail.actions.trashed');
  const mailbox = (await getMailboxes(account)).find((m) => m.name === destination.mailbox);
  return t('mail.actions.moved', { mailbox: mailbox ? mailboxLabel(mailbox) : destination.mailbox });
}

export function useMoveMessages() {
  return useMutation({
    mutationFn: ({ items, destination }: { items: MailItem[]; destination: Destination }) => moveAll(items, destination),
    onMutate: async ({ items }) => {
      await removeMessages(items);
      invalidateMail();
    },
    onSuccess: async (moved, { destination }) => {
      if (!undoable(moved)) return;
      showToast(await movedLabel(destination, moved[0].account), {
        label: t('mail.actions.undo'),
        onClick: () => void moveBack(moved).catch((error: unknown) => showError(t('mail.actions.undoFailed'), explainError(error).summary)),
      });
    },
    onError: async (_error, { items }) => {
      await putMessages(items);
      invalidateMail();
    },
  });
}

// What a row, the reader and the selection bar do to a set of conversations. Moves take each conversation's
// messages in the listed mailbox, so replies stay in Sent (see seenChange for read). Screens showing a
// message close when it leaves, so moves need no callback.
export function useBulkActions() {
  const setFlag = useSetFlag();
  const move = useMoveMessages();

  // `then` runs once the delete goes ahead, which a cancelled confirmation stops.
  const remove = async (items: MailItem[], then?: () => void) => {
    const go = () => {
      move.mutate({ items, destination: 'trash' });
      then?.();
    };
    if (await deletesForGood(items)) confirmAction(t('mail.actions.deleteForever', { count: items.length }), t('mail.actions.delete'), go);
    else go();
  };

  return {
    archive: (conversations: Conversation[]) =>
      move.mutate({ items: conversations.flatMap((c) => c.inView), destination: 'archive' }),
    remove: (conversations: Conversation[], then?: () => void) =>
      void remove(
        conversations.flatMap((c) => c.inView),
        then,
      ),
    toggleSeen: (conversations: Conversation[]) => setFlag.mutate({ ...seenChange(conversations), flag: 'seen' }),
  };
}

// Marking read and unflagging reach the whole conversation, so its row loses the state; marking unread and
// flagging stay in the listed mailbox.
export function useMessageActions(conversation: Conversation) {
  const { latest, messages, inView } = conversation;
  const archive = useRoleMailbox(latest.account, 'archive');
  const bulk = useBulkActions();
  const setFlag = useSetFlag();
  const flagged = messages.filter((m) => m.summary.flags.flagged);

  return {
    archive: archive === latest.mailbox ? undefined : () => bulk.archive([conversation]),
    remove: () => bulk.remove([conversation]),
    toggleSeen: () => bulk.toggleSeen([conversation]),
    toggleFlagged: () =>
      setFlag.mutate(
        flagged.length
          ? { items: flagged, flag: 'flagged', value: false }
          : { items: inView, flag: 'flagged', value: true },
      ),
  };
}
