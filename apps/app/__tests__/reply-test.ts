import type { AttachmentInfo, MessageBody, MessageSummary } from '@/core';
import { prefixSubject, replyPrefill } from '@/mail/reply';

const original: MessageSummary = {
  uid: 7,
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
  subject: 'Q4 planning',
  from: [{ name: 'Claire', email: 'claire@example.com' }],
  to: [
    { name: 'Me', email: 'ME@example.org' },
    { name: 'Paul', email: 'paul@example.com' },
  ],
  cc: [{ email: 'claire@example.com' }, { email: 'lea@example.fr' }, { email: 'me@example.org' }],
  replyTo: [],
  deliveredTo: [],
  date: 1_700_000_000,
  messageId: 'b@example.com',
  references: ['a@example.com'],
  preview: '',
  hasAttachments: false,
  size: 100,
  category: 'primary',
};

const SELF = 'me@example.org';
const OWN = [{ email: SELF }];

const body = (text: string, attachments: AttachmentInfo[] = []): MessageBody => ({
  uid: 7,
  text,
  hasRemoteContent: false,
  blockedRemote: 0,
  listUnsubscribe: [], listUnsubscribeOneClick: false,
  attachments,
});

describe('prefixSubject', () => {
  it('adds Re: and Fwd: once', () => {
    expect(prefixSubject('Hello', 'reply')).toBe('Re: Hello');
    expect(prefixSubject('RE: Hello', 'replyAll')).toBe('RE: Hello');
    expect(prefixSubject('Hello', 'forward')).toBe('Fwd: Hello');
    expect(prefixSubject('Fw: Hello', 'forward')).toBe('Fw: Hello');
    expect(prefixSubject('Re: Hello', 'forward')).toBe('Fwd: Re: Hello');
  });
});

describe('replyPrefill', () => {
  it('answers where the sender asks for replies', () => {
    const fromList = { ...original, replyTo: [{ email: 'list@example.com' }] };
    expect(replyPrefill(fromList, body('Body'), 'reply', OWN, 'Claire wrote:').to).toEqual([{ email: 'list@example.com' }]);
    expect(replyPrefill(fromList, body('Body'), 'replyAll', OWN, 'Claire wrote:').to).toEqual([
      { email: 'list@example.com' },
      { name: 'Paul', email: 'paul@example.com' },
    ]);
  });

  it('replies to the sender and threads the message', () => {
    const prefill = replyPrefill(original, body('Body'), 'reply', OWN, 'Claire wrote:');
    expect(prefill.to).toEqual(original.from);
    expect(prefill.cc).toEqual([]);
    expect(prefill.subject).toBe('Re: Q4 planning');
    expect(prefill.inReplyTo).toBe('b@example.com');
    expect(prefill.references).toEqual(['a@example.com', 'b@example.com']);
    expect(prefill.html).toBe('<br><p>Claire wrote:</p><blockquote><p>Body</p></blockquote>');
  });

  it('replies to everyone except yourself, without repeating an address', () => {
    const prefill = replyPrefill(original, body('Body'), 'replyAll', OWN, '');
    expect(prefill.to.map((a) => a.email)).toEqual(['claire@example.com', 'paul@example.com']);
    expect(prefill.cc.map((a) => a.email)).toEqual(['lea@example.fr']);
  });

  it('leaves out every address of yours, aliases included', () => {
    const toAlias = { ...original, cc: [{ email: 'hello@example.org' }, { email: 'lea@example.fr' }] };
    const prefill = replyPrefill(toAlias, body(''), 'replyAll', [...OWN, { email: 'hello@example.org' }], '');
    expect(prefill.cc.map((a) => a.email)).toEqual(['lea@example.fr']);
  });

  it('answers your own message to its recipients', () => {
    const own = { ...original, from: [{ email: SELF }], to: [{ email: 'paul@example.com' }] };
    expect(replyPrefill(own, body(''), 'reply', OWN, '').to).toEqual([{ email: 'paul@example.com' }]);
  });

  it('keeps the references when the original has no message id', () => {
    const prefill = replyPrefill({ ...original, messageId: undefined }, body(''), 'reply', OWN, '');
    expect(prefill.inReplyTo).toBeUndefined();
    expect(prefill.references).toEqual(['a@example.com']);
  });

  it('forwards with no recipients and the original below the header', () => {
    expect(replyPrefill(original, body('Body'), 'forward', OWN, 'Forwarded')).toEqual({
      to: [],
      cc: [],
      subject: 'Fwd: Q4 planning',
      html: '<br><p>Forwarded</p><p>Body</p>',
      references: [],
      attachments: [],
    });
  });

  it('forwards the attachments but not the images inside the body', () => {
    const report = { index: 2, filename: 'report.pdf', mimeType: 'application/pdf', size: 2048, inline: false };
    const logo = { index: 3, mimeType: 'image/png', size: 300, contentId: 'logo', inline: true };
    expect(replyPrefill(original, body('', [report, logo]), 'forward', OWN, '').attachments).toEqual([report]);
    expect(replyPrefill(original, body('', [report, logo]), 'reply', OWN, '').attachments).toEqual([]);
  });
});