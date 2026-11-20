import type { Contact } from '@/core';
import {
  applyContactSync,
  deleteAccountData,
  getAddressBooks,
  getContact,
  getContactAddresses,
  getContacts,
  getSyncInput,
  putContact,
  removeContact,
  saveAddressBooks,
} from '@/contacts/db';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));

const personal = { href: '/card/personal/', name: 'Personal', readOnly: false };
const shared = { href: '/card/shared/', name: 'Shared', readOnly: true };
const ref = { account: 'a', book: personal.href };

const contact = (href: string, name: string, extra: Partial<Contact> = {}): Contact => ({
  uid: href,
  href,
  etag: `"${href}-1"`,
  name,
  emails: [],
  phones: [],
  vcard: `vcard ${href}`,
  ...extra,
});

const names = async (words: string[] = []) => (await getContacts(words)).map((row) => row.name);

describe('address books', () => {
  it('keeps the sync state of a book that is listed again and drops the one that disappeared', async () => {
    await saveAddressBooks('a', [personal, shared]);
    await applyContactSync(ref, { state: { syncToken: 'token-1', ctag: 'c1' }, reset: true, changed: [], removed: [] });

    await saveAddressBooks('a', [{ ...personal, name: 'Renamed', ctag: 'server-ctag', syncToken: 'server-token' }]);

    const books = await getAddressBooks();
    expect(books.map((book) => [book.name, book.syncToken, book.ctag])).toEqual([['Renamed', 'token-1', 'c1']]);
  });

  it('applies two syncs that run at once', async () => {
    await saveAddressBooks('a', [personal, shared]);

    await Promise.all([
      applyContactSync(ref, {
        state: { syncToken: 'p' },
        reset: true,
        changed: [contact('/card/personal/a.vcf', 'Ada')],
        removed: [],
      }),
      applyContactSync(
        { account: 'a', book: shared.href },
        { state: { syncToken: 's' }, reset: true, changed: [contact('/card/shared/g.vcf', 'Grace')], removed: [] },
      ),
    ]);

    expect(await names()).toEqual(['Ada', 'Grace']);
  });

  it('hands the stored state and etags to the next sync', async () => {
    await saveAddressBooks('a', [personal]);
    await applyContactSync(ref, {
      state: { syncToken: 'token-2' },
      reset: true,
      changed: [contact('/card/personal/ada.vcf', 'Ada Lovelace')],
      removed: [],
    });

    expect(await getSyncInput(ref)).toEqual({
      state: { syncToken: 'token-2', ctag: undefined },
      known: [{ href: '/card/personal/ada.vcf', etag: '"/card/personal/ada.vcf-1"' }],
    });
  });
});

describe('contacts', () => {
  beforeEach(async () => {
    await deleteAccountData('a');
    await deleteAccountData('b');
    await saveAddressBooks('a', [personal]);
  });

  it('applies a sync: changed cards replace stored ones and removed hrefs go', async () => {
    await applyContactSync(ref, {
      state: {},
      reset: true,
      changed: [contact('/1', 'Ada Lovelace'), contact('/2', 'Grace Hopper')],
      removed: [],
    });
    await applyContactSync(ref, {
      state: {},
      reset: false,
      changed: [contact('/1', 'Ada King')],
      removed: ['/2'],
    });
    expect(await names()).toEqual(['Ada King']);
  });

  it('drops every card of the book when the sync resets', async () => {
    await applyContactSync(ref, { state: {}, reset: true, changed: [contact('/1', 'Old')], removed: [] });
    await applyContactSync(ref, { state: {}, reset: true, changed: [contact('/2', 'New')], removed: [] });
    expect(await names()).toEqual(['New']);
  });

  it('lists by family name, then given name', async () => {
    await putContact(ref, contact('/1', 'Ada Lovelace', { given: 'Ada', family: 'Lovelace' }));
    await putContact(ref, contact('/2', 'Grace Hopper', { given: 'Grace', family: 'Hopper' }));
    await putContact(ref, contact('/3', 'Charles Babbage', { given: 'Charles', family: 'Babbage' }));
    expect(await names()).toEqual(['Charles Babbage', 'Grace Hopper', 'Ada Lovelace']);
  });

  it('finds a contact by name, company, address or number with accents folded', async () => {
    await putContact(
      ref,
      contact('/1', 'Élodie Marchand', {
        organization: 'Atelier Marchand',
        emails: [{ value: 'elodie@atelier.test', kind: 'work' }],
        phones: [{ value: '+33 6 12 34 56 78', kind: 'cell' }],
      }),
    );
    await putContact(ref, contact('/2', 'Someone Else'));

    expect(await names(['elod'])).toEqual(['Élodie Marchand']);
    expect(await names(['atelier', 'marchand'])).toEqual(['Élodie Marchand']);
    expect(await names(['elodie@atelier'])).toEqual(['Élodie Marchand']);
    expect(await names(['6 12'])).toEqual(['Élodie Marchand']);
    expect(await names(['elod', 'else'])).toEqual([]);
  });

  it('treats the characters of a LIKE pattern as text', async () => {
    await putContact(ref, contact('/1', '100% Pure'));
    await putContact(ref, contact('/2', 'Plain'));
    expect(await names(['%'])).toEqual(['100% Pure']);
    expect(await names(['_lain'])).toEqual([]);
  });

  it('gives the first address as the list detail and every address for suggestions', async () => {
    await putContact(
      ref,
      contact('/1', 'Ada Lovelace', { emails: [{ value: 'ada@home.test' }, { value: 'ada@work.test', kind: 'work' }] }),
    );
    expect((await getContacts([]))[0].email).toBe('ada@home.test');
    expect(await getContactAddresses()).toEqual([
      { name: 'Ada Lovelace', email: 'ada@home.test' },
      { name: 'Ada Lovelace', email: 'ada@work.test' },
    ]);
  });

  it('reads back everything a card carries, and nothing once it is removed', async () => {
    const full = contact('/1', 'Ada Lovelace', {
      given: 'Ada',
      family: 'Lovelace',
      organization: 'Analytical Engines',
      emails: [{ value: 'ada@work.test', kind: 'work' }],
      phones: [{ value: '+44 20 7946 0000', kind: 'cell' }],
      photo: 'data:image/png;base64,AAAA',
    });
    await putContact(ref, full);
    expect(await getContact({ account: 'a', href: '/1' })).toEqual({
      account: 'a',
      book: personal.href,
      contact: full,
    });

    await removeContact({ account: 'a', href: '/1' });
    expect(await getContact({ account: 'a', href: '/1' })).toBeNull();
  });

  it('forgets an account without touching the others', async () => {
    await saveAddressBooks('b', [personal]);
    await putContact(ref, contact('/1', 'Mine'));
    await putContact({ account: 'b', book: personal.href }, contact('/1', 'Theirs'));

    await deleteAccountData('a');

    expect(await names()).toEqual(['Theirs']);
    expect((await getAddressBooks()).map((book) => book.account)).toEqual(['b']);
  });
});
