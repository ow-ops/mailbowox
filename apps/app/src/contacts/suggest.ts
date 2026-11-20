import type { Address } from '@/core';
import { normalize, queryWords } from '@/utils/text';

import type { ContactAddress } from './db';

const LIMIT = 5;

const tokens = (text: string) => text.split(/[\s@.<>_-]+/);

// Contacts come before addresses only seen in mail; within each, names or addresses that start with what was
// typed come before those that merely contain it. Each address appears once, as its contact has it.
export function suggest(query: string, contacts: ContactAddress[], seen: Address[], taken: Address[]) {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const skip = new Set(taken.map(({ email }) => email.toLowerCase()));
  const candidates = [
    ...contacts.map((contact) => ({ ...contact, rank: 0 })),
    ...seen.map((address) => ({ name: address.name ?? '', email: address.email, rank: 2 })),
  ];
  const found: (Address & { rank: number })[] = [];
  for (const { name, email, rank } of candidates) {
    if (skip.has(email.toLowerCase())) continue;
    const text = normalize(`${name} ${email}`);
    if (!words.every((word) => text.includes(word))) continue;
    skip.add(email.toLowerCase());
    const parts = tokens(text);
    const starts = words.every((word) => parts.some((part) => part.startsWith(word)));
    found.push({ ...(name ? { name } : {}), email, rank: rank + (starts ? 0 : 1) });
  }
  return found
    .sort((a, b) => a.rank - b.rank)
    .slice(0, LIMIT)
    .map(({ rank: _rank, ...address }) => address);
}
