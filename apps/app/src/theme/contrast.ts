import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';

import { isColor } from './theme-file';

extend([a11yPlugin]);

// isColor keeps named colors out, matching what theme files accept.
export function contrastRatio(a: string, b: string): number | null {
  const fg = colord(a.trim());
  const bg = colord(b.trim());
  if (!isColor(a.trim()) || !isColor(b.trim()) || !fg.isValid() || !bg.isValid()) return null;
  return fg.contrast(bg);
}

export const CONTRAST_PAIRS = [
  ['text', 'page', 4.5],
  ['text', 'surface', 4.5],
  ['heading', 'page', 4.5],
  ['heading', 'surface', 4.5],
  ['heading', 'field', 4.5],
  ['muted', 'page', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'field', 4.5],
  ['primary', 'page', 4.5],
  ['primary', 'surface', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['onAccentSoft', 'accentSoft', 4.5],
  ['danger', 'page', 4.5],
  ['danger', 'surface', 4.5],
  ['outline', 'page', 3],
  ['outline', 'field', 3],
] as const;
