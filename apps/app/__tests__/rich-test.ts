import { startHtml } from '@/mail/rich';

describe('startHtml', () => {
  it('leaves an empty line to type in, above the signature and the quoted text', () => {
    expect(startHtml('<blockquote><p>Hi</p></blockquote>', '<p><b>Alice</b></p>')).toBe(
      '<br><p>--&nbsp;</p><p><b>Alice</b></p><blockquote><p>Hi</p></blockquote>',
    );
  });

  it('turns a signature written before the editor into paragraphs', () => {
    expect(startHtml('', 'Alice & co\nAcme')).toBe('<br><p>--&nbsp;</p><p>Alice &#38; co</p><p>Acme</p>');
  });

  it('starts empty with nothing to put below the typing', () => {
    expect(startHtml('')).toBe('');
  });

  it('takes the document wrapper off a signature the editor kept', () => {
    expect(startHtml('', '<html><p>Alice</p></html>')).toBe('<br><p>--&nbsp;</p><p>Alice</p>');
  });
});
