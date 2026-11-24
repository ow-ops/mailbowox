import type { Account } from '@/accounts/store';
import { isFiltered, listFilter } from '@/mail/filters';

const none = { unread: false, flagged: false, toMe: false, attachments: false };
const accounts = [
  { id: 'a', email: 'me@example.com', identities: [{ email: 'hello@example.com' }] },
  { id: 'b', email: 'work@example.org' },
] as Account[];

describe('listFilter', () => {
  it('counts every address of every account as me', () => {
    expect(listFilter({ ...none, toMe: true }, accounts)).toEqual({
      ...none,
      toMe: true,
      me: ['me@example.com', 'hello@example.com', 'work@example.org'],
    });
  });

  it('sends no addresses when To me is off', () => {
    expect(listFilter({ ...none, unread: true }, accounts).me).toEqual([]);
  });

  it('is filtered while any filter is on', () => {
    expect(isFiltered(none)).toBe(false);
    expect(isFiltered({ ...none, attachments: true })).toBe(true);
  });
});
