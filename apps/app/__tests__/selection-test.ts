import type { MessageSummary } from '@/core';
import type { StoredItem } from '@/mail/refs';
import { allSelected, conversationKey, seenChange, selectedConversations, toggled } from '@/mail/selection';
import type { Conversation } from '@/mail/threads';

const message = (uid: number, seen: boolean, mailbox = 'INBOX'): StoredItem => ({
  account: 'a',
  mailbox,
  uidValidity: 1,
  uid,
  thread: 't',
  summary: { uid, flags: { seen, flagged: false, answered: false, draft: false, deleted: false } } as MessageSummary,
});

const conversation = (inView: StoredItem[], others: StoredItem[] = []): Conversation => ({
  latest: inView[inView.length - 1],
  inView,
  messages: [...others, ...inView],
});

describe('selection', () => {
  const read = conversation([message(1, true)]);
  const unread = conversation([message(2, false)]);
  const keys = new Set([conversationKey(read)]);

  it('toggles a key in and out', () => {
    const on = toggled(new Set(), 'x');
    expect([...on]).toEqual(['x']);
    expect([...toggled(on, 'x')]).toEqual([]);
  });

  it('counts only rows still listed', () => {
    expect(selectedConversations([unread], keys)).toEqual([]);
    expect(selectedConversations([read, unread], keys)).toEqual([read]);
  });

  it('knows when every listed row is selected', () => {
    expect(allSelected([read], keys)).toBe(true);
    expect(allSelected([read, unread], keys)).toBe(false);
    expect(allSelected([], keys)).toBe(false);
  });
});

describe('seenChange', () => {
  it('marks the whole conversation read while anything is unread', () => {
    const sentReply = message(7, false, 'Sent');
    const change = seenChange([conversation([message(1, true)]), conversation([message(2, false)], [sentReply])]);
    expect(change.value).toBe(true);
    expect(change.items.map((m) => m.uid)).toEqual([7, 2]);
  });

  it('marks only the listed messages unread when everything is read', () => {
    const change = seenChange([conversation([message(1, true)], [message(9, true, 'Sent')])]);
    expect(change).toEqual({ items: [message(1, true)], value: false });
  });
});
