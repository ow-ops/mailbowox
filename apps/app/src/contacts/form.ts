import type { Contact, ContactDraft, ContactValue } from '@/core';

export type ContactForm = {
  given: string;
  family: string;
  organization: string;
  emails: ContactValue[];
  phones: ContactValue[];
};

export const EMAIL_KINDS = ['home', 'work'];
export const PHONE_KINDS = ['cell', 'home', 'work'];

export const newForm = (): ContactForm => ({ given: '', family: '', organization: '', emails: [], phones: [] });

// A card with only a formatted name has nothing to put in the name parts, so the name goes in the first one and
// saving keeps it.
export const toForm = (contact: Contact): ContactForm => ({
  given: contact.given ?? (contact.family ? '' : contact.name),
  family: contact.family ?? '',
  organization: contact.organization ?? '',
  emails: contact.emails,
  phones: contact.phones,
});

// The kind after `current`, none included, so a value can lose its label again.
export function nextKind(kinds: string[], current: string | undefined) {
  if (current === undefined) return kinds[0];
  return kinds[kinds.indexOf(current) + 1];
}

const filled = (values: ContactValue[]) =>
  values.flatMap(({ value, kind }) => (value.trim() ? [{ value: value.trim(), kind }] : []));

export function toDraft(form: ContactForm): ContactDraft {
  const given = form.given.trim();
  const family = form.family.trim();
  const organization = form.organization.trim();
  const emails = filled(form.emails);
  return {
    name: [given, family].filter(Boolean).join(' ') || organization || emails[0]?.value || '',
    given: given || undefined,
    family: family || undefined,
    emails,
    phones: filled(form.phones),
    organization: organization || undefined,
  };
}
