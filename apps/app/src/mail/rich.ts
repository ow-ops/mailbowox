import type { MessageBody } from '@/core';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// One paragraph per line and a bare break for an empty one, as the editor writes them.
export const textToHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<br>'))
    .join('');

const isHtml = (text: string) => /^\s*</.test(text);

// Signatures written before the editor are plain text.
export const signatureHtml = (signature = '') => (isHtml(signature) ? signature : textToHtml(signature));

// The editor drops a trailing space, so the "-- " that starts a signature is written with a no-break space;
// the text part has the plain one mail clients look for.
export const startHtml = (quoted: string, signature = '') =>
  `<br>${signature ? `<p>--&nbsp;</p>${signatureHtml(signature)}` : ''}${quoted}`;

// The original keeps its formatting under the attribution line; a reply sets it apart as a quote.
export function quotedHtml(header: string, body: MessageBody, asQuote: boolean) {
  const original = body.html ?? textToHtml(body.text ?? '');
  const lines = header.split('\n').filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  return `<br>${lines}${asQuote ? `<blockquote>${original}</blockquote>` : original}`;
}
