import { highlight } from '@/utils/text';

const marked = (text: string, words: string[]) =>
  highlight(text, words)
    .map((s) => (s.match ? `[${s.text}]` : s.text))
    .join('');

describe('highlight', () => {
  it('marks every place a word appears, with case and accents folded', () => {
    expect(marked('Élise sent the invoice to elise', ['elise'])).toBe('[Élise] sent the invoice to [elise]');
  });

  it('marks several words and merges where they overlap', () => {
    expect(marked('Invoice for March', ['invoice', 'voice', 'mar'])).toBe('[Invoice] for [Mar]ch');
  });

  it('leaves text without a match whole', () => {
    expect(highlight('Lunch', ['dinner'])).toEqual([{ text: 'Lunch', match: false }]);
    expect(highlight('Lunch', [])).toEqual([{ text: 'Lunch', match: false }]);
  });
});
