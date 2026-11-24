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

export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trimEnd();
}

export const signatureText = (signature = '') => (isHtml(signature) ? htmlToText(signature) : signature);

// Typing starts in the empty paragraph on top; the signature follows, then what the message quotes.
export const startHtml = (quoted: string, signature = '') =>
  `<br>${signature ? `<p>-- </p>${signatureHtml(signature)}` : ''}${quoted}`;

// The original keeps its formatting under the attribution line; a reply sets it apart as a quote.
export function quotedHtml(header: string, body: MessageBody, asQuote: boolean) {
  const original = body.html ?? textToHtml(body.text ?? '');
  const lines = header.split('\n').filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  return `<br>${lines}${asQuote ? `<blockquote>${original}</blockquote>` : original}`;
}
