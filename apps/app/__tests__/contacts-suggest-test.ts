import { suggest } from '@/contacts/suggest';

const contacts = [
  { name: 'Élodie Marchand', email: 'elodie@atelier.test' },
  { name: 'Marc Dupont', email: 'marc@example.org' },
];
const seen = [
  { name: 'Elodie from billing', email: 'billing@shop.test' },
  { email: 'marchand.sas@example.com' },
  { name: 'Élodie Marchand', email: 'ELODIE@atelier.test' },
];

describe('suggest', () => {
  it('matches the name with accents and case folded', () => {
    expect(suggest('ÉLO', contacts, [], []).map((a) => a.email)).toEqual(['elodie@atelier.test']);
  });

  it('matches part of an address', () => {
    expect(suggest('dupont@', contacts, [], [])).toEqual([]);
    expect(suggest('marc@ex', contacts, [], [])).toEqual([{ name: 'Marc Dupont', email: 'marc@example.org' }]);
  });

  it('wants every word typed to match', () => {
    expect(suggest('marc dup', contacts, [], []).map((a) => a.name)).toEqual(['Marc Dupont']);
    expect(suggest('marc zzz', contacts, [], [])).toEqual([]);
  });

  it('puts contacts before addresses seen in mail', () => {
    expect(suggest('elodie', contacts, seen, []).map((a) => a.email)).toEqual([
      'elodie@atelier.test',
      'billing@shop.test',
    ]);
  });

  it('puts names that start with the text before names that only contain it', () => {
    const found = suggest('arc', [...contacts, { name: 'Arco Iris', email: 'arco@example.org' }], [], []);
    expect(found.map((a) => a.email)).toEqual(['arco@example.org', 'elodie@atelier.test', 'marc@example.org']);
  });

  it('offers an address once, as its contact has it', () => {
    expect(suggest('elodie@atelier', contacts, seen, [])).toEqual([
      { name: 'Élodie Marchand', email: 'elodie@atelier.test' },
    ]);
  });

  it('leaves out addresses already in the field', () => {
    expect(suggest('elodie', contacts, seen, [{ email: 'Elodie@Atelier.test' }]).map((a) => a.email)).toEqual([
      'billing@shop.test',
    ]);
  });

  it('offers nothing for an empty query', () => {
    expect(suggest('  ', contacts, seen, [])).toEqual([]);
  });

  it('stops at five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Ana ${i}`, email: `ana${i}@example.org` }));
    expect(suggest('ana', many, [], [])).toHaveLength(5);
  });
});
