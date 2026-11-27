import { Colors } from '@/constants/theme';
import { bodyDocument, bodyScheme } from '@/mail/body-document';

describe('bodyScheme', () => {
  it('gives unstyled mail the app theme', () => {
    const html = '<div dir="ltr"><p>Lunch at <b>noon</b>?</p><h2>Menu</h2><a href="https://example.org">link</a></div>';
    expect(bodyScheme(html, 'dark')).toBe('dark');
    expect(bodyScheme(html, 'light')).toBe('light');
  });

  it('ignores styles that set no colour', () => {
    expect(bodyScheme('<p style="margin: 0; font-size: 14px">hi</p>', 'dark')).toBe('dark');
  });

  it.each([
    ['an inline text colour', '<p style="color: #333">hi</p>'],
    ['an inline background', '<div style="background-color:#fff">hi</div>'],
    ['a table bgcolor', '<table bgcolor="#f4f4f4"><tbody><tr><td>hi</td></tr></tbody></table>'],
    ['a font colour', '<font color="red">hi</font>'],
    ['a background attribute', '<td background="cid:bg">hi</td>'],
  ])('keeps the light page for mail with %s', (_case, html) => {
    expect(bodyScheme(html, 'dark')).toBe('light');
  });

  it('does not mistake text about colours for styling', () => {
    expect(bodyScheme('<p>The background color is blue.</p>', 'dark')).toBe('dark');
  });
});

describe('bodyDocument', () => {
  it('declares the palette it renders with', () => {
    const page = bodyDocument('<p>hi</p>', false, 'dark', Colors.dark);
    expect(page).toContain('color-scheme: dark');
    expect(page).toContain(`background: ${Colors.dark.page}`);
    expect(page).toContain(`a { color: ${Colors.dark.primary}; }`);
  });
});
