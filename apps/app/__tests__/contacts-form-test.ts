import type { Contact } from '@/core';
import { newForm, nextKind, toDraft, toForm } from '@/contacts/form';

const card = (extra: Partial<Contact>): Contact => ({
  uid: 'u',
  href: '/u.vcf',
  name: 'Ada Lovelace',
  emails: [],
  phones: [],
  vcard: '',
  ...extra,
});

describe('contact form', () => {
  it('builds the name from the first and last name', () => {
    expect(toDraft({ ...newForm(), given: ' Ada ', family: 'Lovelace' })).toMatchObject({
      name: 'Ada Lovelace',
      given: 'Ada',
      family: 'Lovelace',
    });
  });

  it('falls back to the company, then the first address, for a name', () => {
    expect(toDraft({ ...newForm(), organization: 'Analytical Engines' }).name).toBe('Analytical Engines');
    expect(toDraft({ ...newForm(), emails: [{ value: 'ada@work.test' }] }).name).toBe('ada@work.test');
    expect(toDraft(newForm()).name).toBe('');
  });

  it('drops blank values and trims the rest, keeping their kind', () => {
    const draft = toDraft({
      ...newForm(),
      given: 'Ada',
      emails: [{ value: ' ada@work.test ', kind: 'work' }, { value: '  ' }],
      phones: [{ value: '' }],
    });
    expect(draft.emails).toEqual([{ value: 'ada@work.test', kind: 'work' }]);
    expect(draft.phones).toEqual([]);
  });

  it('puts a name the card keeps only as a whole in the first name field', () => {
    expect(toForm(card({ name: 'Pizza Place' })).given).toBe('Pizza Place');
    expect(toForm(card({ given: 'Ada', family: 'Lovelace' }))).toMatchObject({ given: 'Ada', family: 'Lovelace' });
    expect(toForm(card({ family: 'Lovelace' })).given).toBe('');
  });

  it('steps through the kinds and ends on none', () => {
    const kinds = ['home', 'work'];
    expect(nextKind(kinds, undefined)).toBe('home');
    expect(nextKind(kinds, 'home')).toBe('work');
    expect(nextKind(kinds, 'work')).toBeUndefined();
    expect(nextKind(kinds, 'fax')).toBe('home');
  });
});
