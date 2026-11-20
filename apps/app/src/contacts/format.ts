import type { Contact } from '@/core';
import { t } from '@/i18n';

const KINDS = ['home', 'work', 'cell', 'fax'] as const;

const isKnown = (kind: string): kind is (typeof KINDS)[number] => (KINDS as readonly string[]).includes(kind);

// Other kinds are shown as the card spells them.
export const kindLabel = (kind: string | undefined) =>
  kind === undefined ? undefined : isKnown(kind) ? t(`contacts.kind.${kind}`) : kind;

export const displayName = ({ name, emails }: Pick<Contact, 'name' | 'emails'>) => name || emails[0]?.value || '';

export function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((word) => [...word][0].toUpperCase()).join('');
}

// The section a sort key falls under; anything that is not a plain letter shares one.
export const letterOf = (sort: string) => (/^[a-z]/.test(sort) ? sort[0].toUpperCase() : '#');

// A card embedded in the vCard shows as is; one that points at a server is not fetched, which would tell that
// server when the contact is read.
export const embeddedPhoto = (photo: string | undefined) => (photo?.startsWith('data:image/') ? photo : undefined);
