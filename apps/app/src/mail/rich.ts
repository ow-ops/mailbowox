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

const ENTITIES: Record<string, string> = { nbsp: '\u00a0', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return String.fromCodePoint(point);
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

const BLOCKS = new Set(['p', 'div', 'li', 'tr', 'table', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const HIDDEN = new Set(['head', 'style', 'script', 'title']);

// The text part of formatted mail: a line per block, "> " before quoted lines, a dash or number before list
// items and the address after a link's words.
export function htmlToText(html: string) {
  const lines: string[] = [];
  const lists: number[] = [];
  let line = '';
  // A list item's dash or number, then the spaces that line up its next lines.
  let marker = '';
  let depth = 0;
  let hidden = 0;
  let link: { href: string; from: number } | undefined;
  const flush = (always = false) => {
    if (!line && !always) return;
    // The separator keeps the space the editor writes as a no-break one.
    lines.push(line === '--\u00a0' && !depth ? '-- ' : `${'> '.repeat(depth)}${marker}${line}`.trimEnd());
    line = '';
    marker = ' '.repeat(marker.length);
  };
  for (const [token] of html.matchAll(/<[^>]*>|[^<]+/g)) {
    if (!token.startsWith('<')) {
      if (!hidden) line += decode(line ? token.replace(/\s+/g, ' ') : token.replace(/\s+/g, ' ').trimStart());
      continue;
    }
    const tag = /^<(\/?)([a-z0-9]+)/i.exec(token);
    if (!tag) continue;
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    if (HIDDEN.has(name)) hidden += closing ? -1 : 1;
    else if (name === 'br') flush(true);
    else if (name === 'a' && !closing) {
      const href = /href\s*=\s*["']([^"']*)["']/i.exec(token)?.[1];
      link = href ? { href: decode(href), from: line.length } : undefined;
    } else if (name === 'a') {
      if (link && line.slice(link.from).trim() !== link.href.replace(/^mailto:/, '')) line += ` <${link.href}>`;
      link = undefined;
    } else if (BLOCKS.has(name)) {
      flush();
      if (name === 'blockquote') depth += closing ? -1 : 1;
      else if (name === 'ul' || name === 'ol') {
        if (closing) lists.pop();
        else lists.push(name === 'ol' ? 1 : 0);
      } else if (name === 'li') {
        marker = '';
        const at = lists.length - 1;
        const number = lists[at];
        if (!closing) marker = `${'  '.repeat(Math.max(at, 0))}${number ? `${number}. ` : '- '}`;
        if (!closing && number) lists[at] = number + 1;
      }
    }
  }
  flush();
  return lines.join('\n').trimEnd();
}

export const signatureText = (signature = '') => (isHtml(signature) ? htmlToText(signature) : signature);

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
