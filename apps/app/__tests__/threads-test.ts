import type { MessageSummary } from '@/core';
import type { StoredItem } from '@/mail/refs';
import { assignThreads, baseSubject, conversation, type ThreadIndex } from '@/mail/threads';

const message = (
  id: string | undefined,
  date: number,
  extra: Partial<MessageSummary> = {},
): MessageSummary => ({
  uid: date,
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
  subject: 'Lunch',
  from: [{ email: 'bob@example.com' }],
  to: [],
  cc: [],
  replyTo: [],
  deliveredTo: [],
  date,
  messageId: id,
  references: [],
  preview: '',
  hasAttachments: false,
  size: 10,
  ...extra,
});

const emptyIndex = (): ThreadIndex => ({ ids: new Map(), subjects: new Map() });

// Threads each batch in turn against one index, as successive syncs do.
function thread(...batches: MessageSummary[][]) {
  const index = emptyIndex();
  return batches.flatMap(
    (batch) => assignThreads(index, batch.map((summary) => ({ summary, fallback: `INBOX\n${summary.uid}` }))).threads,
  );
}

describe('baseSubject', () => {
  it('strips stacked reply and forward prefixes', () => {
    expect(baseSubject('Re: FWD: re:Lunch ')).toBe('lunch');
    expect(baseSubject('Lunch')).toBe('lunch');
  });
});

describe('assignThreads', () => {
  it('follows a reply chain to its root', () => {
    expect(
      thread([
        message('a', 1),
        message('b', 2, { inReplyTo: 'a', references: ['a'] }),
        message('c', 3, { inReplyTo: 'b', references: ['a', 'b'] }),
      ]),
    ).toEqual(['a', 'a', 'a']);
  });

  it('threads replies by In-Reply-To alone', () => {
    expect(thread([message('a', 1)], [message('b', 2, { inReplyTo: 'a' })], [message('c', 3, { inReplyTo: 'b' })])).toEqual([
      'a',
      'a',
      'a',
    ]);
  });

  it('keeps siblings together when their parent was never seen', () => {
    expect(
      thread(
        [message('b', 2, { references: ['a'] })],
        [message('c', 3, { references: ['a'] })],
        [message('a', 1)],
      ),
    ).toEqual(['a', 'a', 'a']);
  });

  it('threads a batch oldest first whatever order it arrives in', () => {
    expect(
      thread([message('c', 3, { inReplyTo: 'b' }), message('b', 2, { inReplyTo: 'a' }), message('a', 1)]),
    ).toEqual(['a', 'a', 'a']);
  });

  it('merges two conversations once a message links them', () => {
    const index = emptyIndex();
    const first = assignThreads(index, [
      { summary: message('c', 3, { inReplyTo: 'b' }), fallback: '' },
      { summary: message('d', 4, { inReplyTo: 'a' }), fallback: '' },
    ]);
    expect(first.threads).toEqual(['b', 'a']);
    const linking = assignThreads(index, [{ summary: message('b', 2, { inReplyTo: 'a' }), fallback: '' }]);
    expect(linking.threads).toEqual(['a']);
    expect(linking.merges).toEqual([['b', 'a']]);
    expect(index.ids.get('c')).toBe('a');
  });

  it('joins your reply filed in Sent to the conversation it answers', () => {
    const index = emptyIndex();
    const inbox = assignThreads(index, [{ summary: message('a', 1), fallback: 'INBOX\n1' }]);
    const sent = assignThreads(index, [
      { summary: message('mine', 2, { references: ['a'], inReplyTo: 'a', subject: 'Re: Lunch' }), fallback: 'Sent\n1' },
    ]);
    expect(sent.threads).toEqual(inbox.threads);
  });

  it('threads a Re: without references onto the conversation its subject started', () => {
    expect(thread([message('a', 1)], [message('b', 2, { subject: 'RE: lunch' })])).toEqual(['a', 'a']);
  });

  it('keeps the subject out of it otherwise', () => {
    expect(
      thread(
        [message('a', 1)],
        [message('b', 2)],
        [message('c', 3, { subject: 'Fwd: Lunch' })],
        [message('d', 4, { subject: 'Re: Lunch', references: ['elsewhere'] })],
        [message('e', 5, { subject: 'Re: Dinner' })],
      ),
    ).toEqual(['a', 'b', 'c', 'elsewhere', 'e']);
  });

  it('gives a message with no ids a conversation of its own', () => {
    expect(thread([message(undefined, 1)], [message(undefined, 2)])).toEqual(['INBOX\n1', 'INBOX\n2']);
  });
});

describe('conversation', () => {
  const item = (mailbox: string, uid: number, id: string): StoredItem => ({
    account: 'a',
    thread: 'x',
    mailbox,
    uidValidity: 1,
    uid,
    summary: message(id, uid),
  });

  it('lists the conversation oldest first, once per message, without Trash', () => {
    const first = item('INBOX', 1, 'x');
    const mine = item('Sent', 2, 'y');
    const toSelf = item('INBOX', 3, 'y');
    const deleted = item('Trash', 4, 'z');
    const latest = item('INBOX', 5, 'w');
    const result = conversation(latest, [latest, deleted, mine, toSelf, first], ['Trash']);
    expect(result.messages).toEqual([first, toSelf, latest]);
    expect(result.inView).toEqual([first, toSelf, latest]);
  });

  it('keeps Trash messages when the conversation is viewed there', () => {
    const deleted = item('Trash', 4, 'z');
    expect(conversation(deleted, [deleted, item('INBOX', 1, 'x')], ['Trash']).messages).toHaveLength(2);
  });
});
