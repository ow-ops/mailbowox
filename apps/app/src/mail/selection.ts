import { createStore, useStore } from 'zustand';

import { messageKey, sameMessage, type MailItem, type MessageRef } from './refs';
import type { Conversation } from './threads';

export const conversationKey = ({ latest }: Conversation) => messageKey(latest);

type Selection = { selecting: boolean; keys: ReadonlySet<string>; moving: MailItem[] };

const selectionStore = createStore<Selection>(() => ({ selecting: false, keys: new Set(), moving: [] }));

export const useSelection = () => useStore(selectionStore);

export const useSelecting = () => useStore(selectionStore, (state) => state.selecting);

export const useMovingItems = () => useStore(selectionStore, (state) => state.moving);

export const startSelecting = (key?: string) =>
  selectionStore.setState({ selecting: true, keys: new Set(key ? [key] : []) });

export const stopSelecting = () => selectionStore.setState({ selecting: false, keys: new Set(), moving: [] });

export const setSelected = (keys: string[]) => selectionStore.setState({ keys: new Set(keys) });

export const toggleSelected = (key: string) => selectionStore.setState((state) => ({ keys: toggled(state.keys, key) }));

// The move screen reads what it moves from here.
export const setMovingItems = (moving: MailItem[]) => selectionStore.setState({ moving });

export function toggled(keys: ReadonlySet<string>, key: string) {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

// Only rows still listed count, so a conversation archived elsewhere or gone after a sync drops out.
export const selectedConversations = (conversations: Conversation[], keys: ReadonlySet<string>) =>
  conversations.filter((c) => keys.has(conversationKey(c)));

export const allSelected = (conversations: Conversation[], keys: ReadonlySet<string>) =>
  conversations.length > 0 && conversations.every((c) => keys.has(conversationKey(c)));

// Marking read reaches whole conversations; marking unread only what is listed. Read wins while anything
// selected is unread.
export function seenChange(conversations: Conversation[]) {
  const unread = conversations.flatMap((c) => c.messages.filter((m) => !m.summary.flags.seen));
  if (unread.length) return { items: unread, value: true };
  return { items: conversations.flatMap((c) => c.inView), value: false };
}

// A row of the list j, k and Enter move through: the message it opens and every message it stands for.
export type Entry = { open: MessageRef; holds: MessageRef[] };

export const indexOf = (entries: Entry[], message: MessageRef | null) =>
  message ? entries.findIndex((entry) => entry.holds.some((m) => sameMessage(m, message))) : -1;

// The message that takes the place of one that left the list at `position`: the row that was below it, or the
// last row when it was at the bottom. The list may not have dropped it yet, so it is skipped either way.
export function replacement(entries: Entry[], gone: MessageRef, position: number) {
  const left = entries.filter((entry) => !entry.holds.some((m) => sameMessage(m, gone)));
  return left[Math.min(position, left.length - 1)]?.open ?? null;
}
