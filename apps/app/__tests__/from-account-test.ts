import type { Account } from '@/accounts/store';
import type { MessageSummary } from '@/core';
import { newMessageSender, replySender, senders } from '@/mail/from';

const account = (id: string, email: string, extra: Partial<Account> = {}): Account => ({
  id,
  email,
  displayName: '',
  username: email,
  imap: { host: 'imap', port: 993, security: 'tls' },
  smtp: { host: 'smtp', port: 465, security: 'tls' },
  ...extra,
});

const alice = account('a', 'alice@mailbowox.test', {
  displayName: 'Alice',
  identities: [{ email: 'hello@mailbowox.test', name: 'Hello' }, { email: 'shop@mailbowox.test' }],
});
const bob = account('b', 'bob@mailbowox.test');
const accounts = [alice, bob];

const message = (to: string[], cc: string[] = [], deliveredTo: string[] = []): MessageSummary => ({
  uid: 1,
  flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false },
  subject: 'Hello',
  from: [{ email: 'carol@example.com' }],
  to: to.map((email) => ({ email })),
  cc: cc.map((email) => ({ email })),
  replyTo: [],
  deliveredTo,
  date: 0,
  references: [],
  preview: '',
  hasAttachments: false,
  size: 1,
  category: 'primary',
});

const reply = (original: MessageSummary, arrivedIn: string) => replySender(accounts, original, arrivedIn);

describe('senders', () => {
  it('lists each account address first, then its identities', () => {
    expect(senders(accounts).map((s) => s.address.email)).toEqual([
      'alice@mailbowox.test',
      'hello@mailbowox.test',
      'shop@mailbowox.test',
      'bob@mailbowox.test',
    ]);
  });

  it('signs an identity with its own name, else with the account name', () => {
    const [, hello, shop, bobSender] = senders(accounts);
    expect(hello.address.name).toBe('Hello');
    expect(shop.address.name).toBe('Alice');
    expect(bobSender.address.name).toBeUndefined();
  });
});

describe('replySender', () => {
  it('answers from the account the message was addressed to', () => {
    expect(reply(message(['Bob@Mailbowox.test']), 'a').account).toBe('b');
    expect(reply(message(['x@example.com'], ['bob@mailbowox.test']), 'a').account).toBe('b');
  });

  it('answers from the identity the message was addressed to, whatever the case', () => {
    expect(reply(message(['Hello@MAILBOWOX.test']), 'a').address.email).toBe('hello@mailbowox.test');
    expect(reply(message(['x@example.com'], ['shop@mailbowox.test']), 'a').address.email).toBe('shop@mailbowox.test');
  });

  it('uses Delivered-To when neither To nor Cc names an address of ours', () => {
    expect(reply(message(['list@example.com'], [], ['hello@mailbowox.test']), 'a').address.email).toBe(
      'hello@mailbowox.test',
    );
  });

  it('prefers To and Cc over a Delivered-To that names the mailbox behind an alias', () => {
    const original = message(['hello@mailbowox.test'], [], ['alice@mailbowox.test']);
    expect(reply(original, 'a').address.email).toBe('hello@mailbowox.test');
  });

  it('prefers the account it arrived in when several were addressed', () => {
    expect(reply(message(['alice@mailbowox.test', 'bob@mailbowox.test']), 'b').account).toBe('b');
  });

  it('falls back to the address of the account it arrived in, as for a list or a Bcc', () => {
    expect(reply(message(['list@example.com']), 'b').address.email).toBe('bob@mailbowox.test');
  });
});

describe('newMessageSender', () => {
  const unified = { kind: 'unified' } as const;

  it('uses the address of the account being viewed', () => {
    const sender = newMessageSender(accounts, { kind: 'mailbox', account: 'b', mailbox: 'INBOX' }, 'hello@mailbowox.test');
    expect(sender.address.email).toBe('bob@mailbowox.test');
  });

  it('uses the address picked last in views that mix accounts', () => {
    expect(newMessageSender(accounts, unified, 'hello@mailbowox.test').address.email).toBe('hello@mailbowox.test');
    expect(newMessageSender(accounts, { kind: 'unread' }, 'bob@mailbowox.test').account).toBe('b');
  });

  it('uses the first address when nothing was picked or the pick was removed', () => {
    expect(newMessageSender(accounts, unified, null).address.email).toBe('alice@mailbowox.test');
    expect(newMessageSender(accounts, unified, 'gone@mailbowox.test').address.email).toBe('alice@mailbowox.test');
  });
});
