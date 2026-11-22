import type { AddressBook, Contact, ContactSyncResult, ContactSyncState, ContactTag, ContactValue } from '@/core';
import { lazyDatabase, type Database } from '@/db/migrate';
import { transactionQueue } from '@/db/transactions';
import { normalize } from '@/utils/text';

export type BookRef = { account: string; book: string };
export type ContactRef = { account: string; href: string };
type StoredAddressBook = AddressBook & { account: string };
export type StoredContact = BookRef & { contact: Contact };
export type ContactRow = ContactRef & {
  name: string;
  organization?: string;
  email?: string;
  sort: string;
};
export type ContactAddress = { name: string; email: string };

const SCHEMA = `
  CREATE TABLE address_books (
    account TEXT NOT NULL,
    href TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    read_only INTEGER NOT NULL,
    ctag TEXT,
    sync_token TEXT,
    PRIMARY KEY (account, href)
  );
  CREATE TABLE contacts (
    account TEXT NOT NULL,
    href TEXT NOT NULL,
    book TEXT NOT NULL,
    uid TEXT NOT NULL,
    etag TEXT,
    name TEXT NOT NULL,
    given TEXT,
    family TEXT,
    organization TEXT,
    emails TEXT NOT NULL,
    phones TEXT NOT NULL,
    photo TEXT,
    vcard TEXT NOT NULL,
    sort TEXT NOT NULL,
    search TEXT NOT NULL,
    PRIMARY KEY (account, href)
  );
  CREATE INDEX contacts_by_book ON contacts (account, book);
  CREATE INDEX contacts_by_sort ON contacts (sort);
`;

export const MIGRATIONS = [SCHEMA];

const database = lazyDatabase('contacts.db', MIGRATIONS);

const transaction = transactionQueue(database);

type BookRow = {
  account: string;
  href: string;
  name: string;
  read_only: number;
  ctag: string | null;
  sync_token: string | null;
};

const toBook = (row: BookRow): StoredAddressBook => ({
  account: row.account,
  href: row.href,
  name: row.name,
  ctag: row.ctag ?? undefined,
  syncToken: row.sync_token ?? undefined,
  readOnly: row.read_only === 1,
});

export async function getAddressBooks() {
  const db = await database();
  const rows = await db.getAllAsync<BookRow>('SELECT * FROM address_books ORDER BY account, position');
  return rows.map(toBook);
}

async function removeBookContacts(db: Database, { account, book }: BookRef) {
  await db.runAsync('DELETE FROM contacts WHERE account = ? AND book = ?', account, book);
}

// The server's ctag and sync token describe the server; ours describe what was last synced, so they are kept.
export async function saveAddressBooks(account: string, books: AddressBook[]) {
  await transaction(async (db) => {
    const stored = await db.getAllAsync<{ href: string }>('SELECT href FROM address_books WHERE account = ?', account);
    for (const { href } of stored) {
      if (books.some((book) => book.href === href)) continue;
      await removeBookContacts(db, { account, book: href });
      await db.runAsync('DELETE FROM address_books WHERE account = ? AND href = ?', account, href);
    }
    for (const [position, book] of books.entries()) {
      await db.runAsync(
        `INSERT INTO address_books (account, href, position, name, read_only) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (account, href) DO UPDATE SET
           position = excluded.position, name = excluded.name, read_only = excluded.read_only`,
        account,
        book.href,
        position,
        book.name,
        book.readOnly ? 1 : 0,
      );
    }
  });
}

export async function getSyncInput({ account, book }: BookRef) {
  const db = await database();
  const row = await db.getFirstAsync<{ ctag: string | null; sync_token: string | null }>(
    'SELECT ctag, sync_token FROM address_books WHERE account = ? AND href = ?',
    account,
    book,
  );
  const known = await db.getAllAsync<ContactTag>(
    'SELECT href, etag FROM contacts WHERE account = ? AND book = ? AND etag IS NOT NULL',
    account,
    book,
  );
  const state: ContactSyncState | undefined =
    row?.ctag || row?.sync_token ? { ctag: row.ctag ?? undefined, syncToken: row.sync_token ?? undefined } : undefined;
  return { state, known };
}

const sortKey = ({ name, given, family }: Contact) => normalize(`${family ?? ''} ${given ?? ''}`.trim() || name);

const searchText = (contact: Contact) =>
  normalize(
    [
      contact.name,
      contact.organization,
      ...contact.emails.map((email) => email.value),
      ...contact.phones.map((phone) => phone.value),
    ]
      .filter(Boolean)
      .join('\n'),
  );

async function upsert(db: Database, { account, book }: BookRef, contact: Contact) {
  await db.runAsync(
    `INSERT OR REPLACE INTO contacts (account, href, book, uid, etag, name, given, family, organization, emails, phones,
       photo, vcard, sort, search)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    account,
    contact.href,
    book,
    contact.uid,
    contact.etag ?? null,
    contact.name,
    contact.given ?? null,
    contact.family ?? null,
    contact.organization ?? null,
    JSON.stringify(contact.emails),
    JSON.stringify(contact.phones),
    contact.photo ?? null,
    contact.vcard,
    sortKey(contact),
    searchText(contact),
  );
}

export async function applyContactSync(ref: BookRef, result: ContactSyncResult) {
  await transaction(async (db) => {
    if (result.reset) await removeBookContacts(db, ref);
    for (const href of result.removed) {
      await db.runAsync('DELETE FROM contacts WHERE account = ? AND href = ?', ref.account, href);
    }
    for (const contact of result.changed) await upsert(db, ref, contact);
    await db.runAsync(
      'UPDATE address_books SET ctag = ?, sync_token = ? WHERE account = ? AND href = ?',
      result.state.ctag ?? null,
      result.state.syncToken ?? null,
      ref.account,
      ref.book,
    );
  });
}

export async function putContact(ref: BookRef, contact: Contact) {
  await transaction((db) => upsert(db, ref, contact));
}

export async function removeContact({ account, href }: ContactRef) {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM contacts WHERE account = ? AND href = ?', account, href);
  });
}

type ListRow = {
  account: string;
  href: string;
  name: string;
  organization: string | null;
  emails: string;
  sort: string;
};

const escapeLike = (word: string) => word.replace(/[\\%_]/g, '\\$&');

// Every word has to appear in the name, company, an address or a number; `words` come from queryWords, already folded.
export async function getContacts(words: string[]): Promise<ContactRow[]> {
  const db = await database();
  const filter = words.map(() => "search LIKE '%' || ? || '%' ESCAPE '\\'").join(' AND ');
  const rows = await db.getAllAsync<ListRow>(
    `SELECT account, href, name, organization, emails, sort FROM contacts ${filter ? `WHERE ${filter}` : ''}
     ORDER BY sort, name`,
    words.map(escapeLike),
  );
  return rows.map((row) => ({
    account: row.account,
    href: row.href,
    name: row.name,
    organization: row.organization ?? undefined,
    email: (JSON.parse(row.emails) as ContactValue[])[0]?.value,
    sort: row.sort,
  }));
}

export async function getContactAddresses(): Promise<ContactAddress[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ name: string; emails: string }>(
    'SELECT name, emails FROM contacts ORDER BY sort',
  );
  return rows.flatMap(({ name, emails }) =>
    (JSON.parse(emails) as ContactValue[]).map(({ value }) => ({ name, email: value })),
  );
}

type ContactDetailRow = {
  book: string;
  uid: string;
  href: string;
  etag: string | null;
  name: string;
  given: string | null;
  family: string | null;
  organization: string | null;
  emails: string;
  phones: string;
  photo: string | null;
  vcard: string;
};

export async function getContact({ account, href }: ContactRef): Promise<StoredContact | null> {
  const db = await database();
  const row = await db.getFirstAsync<ContactDetailRow>(
    'SELECT * FROM contacts WHERE account = ? AND href = ?',
    account,
    href,
  );
  if (!row) return null;
  return {
    account,
    book: row.book,
    contact: {
      uid: row.uid,
      href: row.href,
      etag: row.etag ?? undefined,
      name: row.name,
      given: row.given ?? undefined,
      family: row.family ?? undefined,
      organization: row.organization ?? undefined,
      emails: JSON.parse(row.emails) as ContactValue[],
      phones: JSON.parse(row.phones) as ContactValue[],
      photo: row.photo ?? undefined,
      vcard: row.vcard,
    },
  };
}

export async function storedAccounts() {
  const db = await database();
  const rows = await db.getAllAsync<{ account: string }>(
    'SELECT account FROM address_books UNION SELECT account FROM contacts',
  );
  return rows.map((row) => row.account);
}

export async function deleteAccountData(account: string) {
  await transaction(async (db) => {
    for (const table of ['address_books', 'contacts']) {
      await db.runAsync(`DELETE FROM ${table} WHERE account = ?`, account);
    }
  });
}
