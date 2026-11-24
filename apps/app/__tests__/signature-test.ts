import { sign } from '@/mail/reply';
import { signatureText, startHtml } from '@/mail/rich';

const quoted = '\n\nOn Monday, Bob wrote:\n> Hi';

describe('sign', () => {
  it('ends a new message with the signature, after the usual delimiter', () => {
    expect(sign('', 'Alice\nAcme')).toBe('\n\n-- \nAlice\nAcme');
  });

  it('puts the signature above the quoted text of a reply', () => {
    expect(sign(quoted, 'Alice')).toBe(`\n\n-- \nAlice${quoted}`);
  });

  it('adds nothing for an account without a signature', () => {
    expect(sign(quoted)).toBe(quoted);
  });
});

describe('startHtml', () => {
  it('leaves an empty line to type in, above the signature and the quoted text', () => {
    expect(startHtml('<blockquote><p>Hi</p></blockquote>', '<p><b>Alice</b></p>')).toBe(
      '<br><p>-- </p><p><b>Alice</b></p><blockquote><p>Hi</p></blockquote>',
    );
  });

  it('turns a signature written before the editor into paragraphs', () => {
    expect(startHtml('', 'Alice & co\nAcme')).toBe('<br><p>-- </p><p>Alice &#38; co</p><p>Acme</p>');
  });
});

describe('signatureText', () => {
  it('reads a formatted signature as lines of text', () => {
    expect(signatureText('<html><p><b>Alice</b> &amp; co</p><p>Acme</p></html>')).toBe('Alice & co\nAcme');
  });

  it('keeps a plain signature as it is', () => {
    expect(signatureText('Alice\nAcme')).toBe('Alice\nAcme');
  });
});
