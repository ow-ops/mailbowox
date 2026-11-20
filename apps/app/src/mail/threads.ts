import type { MessageSummary } from '@/core';

import type { StoredItem } from './refs';

export type ThreadIndex = { ids: Map<string, string>; subjects: Map<string, string> };

// What a list row and the reader show for one conversation. `latest` is its newest message in the viewed
// mailbox, `inView` all of them there, `messages` the whole conversation across the account's mailboxes,
// oldest first, one copy per message.
export type Conversation = { latest: StoredItem; messages: StoredItem[]; inView: StoredItem[] };

const REPLY = /^\s*re\s*:/i;
const PREFIXES = /^(\s*(re|fwd?)\s*:)+/i;

export const baseSubject = (subject: string) => subject.replace(PREFIXES, '').trim().toLowerCase();

const unique = (values: string[]) => [...new Set(values)];

const parentIds = (summary: MessageSummary) =>
  unique(summary.inReplyTo ? [...summary.references, summary.inReplyTo] : summary.references);

// The root comes first: References lists the oldest ancestor first.
export const threadIds = (summary: MessageSummary) =>
  summary.messageId ? unique([...parentIds(summary), summary.messageId]) : parentIds(summary);

// JWZ-style: a message joins the conversation of any message it references or that references it;
// conversations it links merge. Subject alone only threads a "Re:" with no references, onto the latest
// conversation under that subject.
function assignThread(index: ThreadIndex, summary: MessageSummary, fallback: string) {
  const refs = parentIds(summary);
  const ids = threadIds(summary);
  const found = unique(ids.flatMap((id) => index.ids.get(id) ?? []));
  const subject = baseSubject(summary.subject);
  const orphanReply = refs.length === 0 && REPLY.test(summary.subject) ? index.subjects.get(subject) : undefined;
  const thread = found[0] ?? orphanReply ?? ids[0] ?? fallback;
  const merged = found.slice(1);

  if (merged.length) {
    for (const map of [index.ids, index.subjects]) {
      for (const [key, value] of map) if (merged.includes(value)) map.set(key, thread);
    }
  }
  for (const id of ids) index.ids.set(id, thread);
  if (refs.length === 0 && subject && !PREFIXES.test(summary.subject)) index.subjects.set(subject, thread);
  return { thread, merged };
}

// Oldest first, so a reply finds the conversation its parent started. `threads` follows the input order
// and `merges` maps each conversation that was absorbed to the one it ended up in.
export function assignThreads(index: ThreadIndex, messages: { summary: MessageSummary; fallback: string }[]) {
  const into = new Map<string, string>();
  const threads: string[] = [];
  const order = messages.map((_, i) => i).sort((a, b) => messages[a].summary.date - messages[b].summary.date);
  for (const i of order) {
    const { thread, merged } = assignThread(index, messages[i].summary, messages[i].fallback);
    threads[i] = thread;
    for (const from of merged) into.set(from, thread);
  }
  const resolve = (thread: string): string => {
    const next = into.get(thread);
    return next ? resolve(next) : thread;
  };
  return {
    threads: threads.map(resolve),
    merges: [...into.keys()].map((from) => [from, resolve(from)] as const),
  };
}

export const single = (item: StoredItem): Conversation => ({ latest: item, messages: [item], inView: [item] });

const byDate = (a: StoredItem, b: StoredItem) => a.summary.date - b.summary.date || a.uid - b.uid;

// `members` is every stored message of the conversation. Messages in `hidden` mailboxes (Trash, Junk) stay
// out unless viewed there; a message filed twice (sent to yourself) shows once, preferably the copy in the
// viewed mailbox.
export function conversation(latest: StoredItem, members: StoredItem[], hidden: string[]): Conversation {
  const inView = members.filter((m) => m.mailbox === latest.mailbox).sort(byDate);
  const shown = new Map<string, StoredItem>();
  for (const member of [...inView, ...members.filter((m) => !hidden.includes(m.mailbox))]) {
    const key = member.summary.messageId ?? `${member.mailbox}\n${member.uid}`;
    if (!shown.has(key)) shown.set(key, member);
  }
  return { latest, messages: [...shown.values()].sort(byDate), inView };
}
