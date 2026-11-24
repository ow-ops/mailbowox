import type { Address, MessageSummary, SearchQuery as StoreQuery } from '@/core';

import { normalize } from '@/utils/text';

import { messageKey, type StoredItem } from './refs';

const FIELD = /^(from|to|cc|subject):(.+)$/;

type Field = 'from' | 'to' | 'cc' | 'subject';

// `words` may be anywhere in a message; a field's value must be in that field. `server` is the query the
// server is asked: has:attachment is left out of it, IMAP having no way to search for one.
export type SearchQuery = {
  words: string[];
  fields: { field: Field; value: string }[];
  seen?: boolean;
  flagged?: boolean;
  attachments?: boolean;
  server: string;
};

export function parseQuery(text: string): SearchQuery {
  const query: SearchQuery = { words: [], fields: [], server: '' };
  const server: string[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const token = normalize(raw);
    if (token === 'has:attachment') {
      query.attachments = true;
      continue;
    }
    server.push(raw);
    const [, field, value] = FIELD.exec(token) ?? [];
    if (token === 'is:unread' || token === 'is:read') query.seen = token === 'is:read';
    else if (token === 'is:starred' || token === 'is:flagged') query.flagged = true;
    else if (field) query.fields.push({ field: field as Field, value });
    else if (!query.words.includes(token)) query.words.push(token);
  }
  return { ...query, server: server.join(' ') };
}

export const isEmptyQuery = (query: SearchQuery) => !query.server && !query.attachments;

// What the store narrows by; a field's value is then checked against its own field here.
export const storeQuery = (query: SearchQuery): StoreQuery => ({
  terms: [...query.words, ...query.fields.map(({ value }) => value)],
  fields: query.fields.length > 0,
  seen: query.seen,
  flagged: !!query.flagged,
  attachments: !!query.attachments,
});

const names = (addresses: Address[]) => addresses.flatMap((a) => (a.name ? [a.name, a.email] : [a.email]));

const people = (summary: MessageSummary) => names([...summary.from, ...summary.to, ...summary.cc]);

const heading = (summary: MessageSummary) => normalize([summary.subject, ...people(summary)].join('\n'));

// to: also looks in Cc, as someone a message was sent to may be in either.
function fieldText(summary: MessageSummary, field: Field) {
  if (field === 'subject') return summary.subject;
  return names(field === 'to' ? [...summary.to, ...summary.cc] : summary[field]).join('\n');
}

// The flags are left to the database and the server, which filter on them before this runs.
const matchesQuery = (summary: MessageSummary, query: SearchQuery) =>
  query.fields.every(({ field, value }) => normalize(fieldText(summary, field)).includes(value)) &&
  (!query.attachments || summary.hasAttachments);

function tier(summary: MessageSummary, words: string[]) {
  const head = heading(summary);
  if (words.every((word) => head.includes(word))) return 2;
  const preview = normalize(summary.preview);
  return words.every((word) => head.includes(word) || preview.includes(word)) ? 1 : 0;
}

// One row per message. Those whose subject or people hold every word come first, then those that need the
// preview, then the server's matches found only in the body; newest first within each.
export function rankResults(items: StoredItem[], query: SearchQuery) {
  const unique = new Map(items.map((item) => [messageKey(item), item]));
  return [...unique.values()]
    .filter((item) => matchesQuery(item.summary, query))
    .map((item) => ({ item, tier: tier(item.summary, query.words) }))
    .sort((a, b) => b.tier - a.tier || b.item.summary.date - a.item.summary.date)
    .map(({ item }) => item);
}
