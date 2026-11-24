import i18n, { t } from '@/i18n';
import { printDocument } from '@/mail/print-document';
import type { StoredItem } from '@/mail/refs';

const item = (subject: string, from: string): StoredItem => ({
  account: 'a',
  mailbox: 'INBOX',
  uidValidity: 1,
  uid: 1,
  thread: 't',
  summary: {
    uid: 1,
    flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
    subject,
    from: [{ name: from, email: 'bob@example.com' }],
    to: [{ email: 'alice@example.com' }],
    cc: [],
    replyTo: [],
    deliveredTo: [],
    date: 1_700_000_000,
    references: [],
    preview: '',
    hasAttachments: false,
    size: 10,
    category: 'primary',
  },
});

const body = (fields: { html?: string; text?: string }) => ({
  uid: 1,
  hasRemoteContent: false,
  blockedRemote: 0,
  attachments: [],
  listUnsubscribe: [],
  listUnsubscribeOneClick: false,
  ...fields,
});

beforeAll(() => i18n.changeLanguage('en'));

describe('printDocument', () => {
  it('puts each message under its headers, the subject on top', () => {
    const html = printDocument(t, [
      { item: item('Plans <draft>', 'Bob'), body: body({ html: '<p>See you <b>Friday</b></p>' }) },
      { item: item('Re: Plans', 'Alice & co'), body: body({ text: 'Sure <3' }) },
    ]);
    expect(html).toContain('<title>Plans &#60;draft&#62;</title>');
    expect(html).toContain('<p>From: Bob &#60;bob@example.com&#62;</p>');
    expect(html).toContain('<p>See you <b>Friday</b></p>');
    expect(html).toContain('<pre>Sure &#60;3</pre>');
    expect(html).toContain('Alice &#38; co');
  });

  it('loads nothing remote', () => {
    expect(printDocument(t, [])).toContain("img-src data: cid:");
  });
});
