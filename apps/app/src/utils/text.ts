const MARKS = /[\u0300-\u036f]/g;

// Folds case and accents, so "elise" finds "Élise".
export const normalize = (text: string) => text.normalize('NFD').replace(MARKS, '').toLowerCase();

export const queryWords = (query: string) => [...new Set(normalize(query).split(/\s+/).filter(Boolean))];

export type Segment = { text: string; match: boolean };

// `text` split around every place one of `words` appears, compared as normalize compares.
export function highlight(text: string, words: string[]): Segment[] {
  let folded = '';
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    for (const part of normalize(char)) {
      folded += part;
      origin.push(index);
    }
    index += char.length;
  }
  const ranges: [number, number][] = [];
  for (const word of words.filter(Boolean)) {
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + 1)) {
      const end = at + word.length;
      ranges.push([origin[at], end < origin.length ? origin[end] : text.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let from = 0;
  for (const [start, end] of ranges) {
    if (end <= from) continue;
    if (start > from) segments.push({ text: text.slice(from, start), match: false });
    segments.push({ text: text.slice(Math.max(start, from), end), match: true });
    from = end;
  }
  if (from < text.length) segments.push({ text: text.slice(from), match: false });
  return segments;
}
