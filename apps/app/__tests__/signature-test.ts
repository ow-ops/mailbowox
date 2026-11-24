import { htmlToText, signatureText, startHtml } from '@/mail/rich';

describe('startHtml', () => {
  it('leaves an empty line to type in, above the signature and the quoted text', () => {
    expect(startHtml('<blockquote><p>Hi</p></blockquote>', '<p><b>Alice</b></p>')).toBe(
      '<br><p>--&nbsp;</p><p><b>Alice</b></p><blockquote><p>Hi</p></blockquote>',
    );
  });

  it('turns a signature written before the editor into paragraphs', () => {
    expect(startHtml('', 'Alice & co\nAcme')).toBe('<br><p>--&nbsp;</p><p>Alice &#38; co</p><p>Acme</p>');
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

describe('htmlToText', () => {
  it('writes the signature separator mail clients look for', () => {
    expect(htmlToText(startHtml('', 'Alice'))).toBe('\n-- \nAlice');
  });

  it('puts a link address after its words', () => {
    const html =
      '<p>Read the <a href="https://example.org/docs">docs</a>, or <a href="https://example.org">https://example.org</a></p>';
    expect(htmlToText(html)).toBe('Read the docs <https://example.org/docs>, or https://example.org');
  });

  it('marks quoted lines and list items', () => {
    const html = [
      '<p>Sure.</p><br><p>Bob wrote:</p>',
      '<blockquote><p>Bring:</p><ul><li><p>bread</p></li><li>wine</li></ul><blockquote><p>older</p></blockquote></blockquote>',
      '<ol><li>one</li><li>two</li></ol>',
    ].join('');
    expect(htmlToText(html)).toBe('Sure.\n\nBob wrote:\n> Bring:\n> - bread\n> - wine\n> > older\n1. one\n2. two');
  });

  it('leaves out styles, scripts and comments of a quoted original', () => {
    const html = '<html><head><style>p { color: red }</style></head><body><!-- x --><p>Hi&nbsp;&amp; bye</p></body></html>';
    expect(htmlToText(html)).toBe('Hi\u00a0& bye');
  });
});
