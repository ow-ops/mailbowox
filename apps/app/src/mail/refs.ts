import type { Conversation, MessageSummary } from '@/core';

export type { Conversation } from '@/core';

export type MailboxRef = { account: string; mailbox: string };
export type MailboxGeneration = MailboxRef & { uidValidity: number };
export type MessageRef = MailboxGeneration & { uid: number };

export type MailItem = MessageRef & { summary: MessageSummary };
// As the cache holds it, with its conversation.
export type StoredItem = MailItem & { thread: string };

export const messageKey = (ref: MessageRef) => JSON.stringify([ref.account, ref.mailbox, ref.uidValidity, ref.uid]);
export const sameMessage = (a: MessageRef, b: MessageRef) => messageKey(a) === messageKey(b);

export const messageParams = ({ account, mailbox, uidValidity, uid }: MessageRef) =>
  ({ account, mailbox, uidValidity: String(uidValidity), uid: String(uid) });

export const single = (item: StoredItem): Conversation => ({ latest: item, messages: [item], inView: [item] });
