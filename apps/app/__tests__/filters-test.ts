import type { Account } from '@/accounts/store';
import { isFiltered, listFilter, shownBoxes } from '@/mail/filters';

const none = { unread: false, flagged: false, toMe: false, ccMe: false, attachments: false, today: false };
const accounts = [
  { id: 'a', email: 'me@example.com', identities: [{ email: 'hello@example.com' }] },
  { id: 'b', email: 'work@example.org' },
] as Account[];

describe('listFilter', () => {
  it('counts every address of every account as me', () => {
    const { today: _, ...flags } = none;
    expect(listFilter({ ...none, toMe: true }, accounts)).toEqual({
      ...flags,
      toMe: true,
      me: ['me@example.com', 'hello@example.com', 'work@example.org'],
      since: undefined,
      category: undefined,
    });
    expect(listFilter({ ...none, ccMe: true }, accounts).me).toHaveLength(3);
  });

  it('sends no addresses when To me is off', () => {
    expect(listFilter({ ...none, unread: true }, accounts).me).toEqual([]);
  });

  it('starts Today at local midnight', () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 24, 15, 30) });
    expect(listFilter({ ...none, today: true }, accounts).since).toBe(new Date(2026, 10, 24).getTime() / 1000);
    jest.useRealTimers();
  });

  it('is filtered while any filter is on', () => {
    expect(isFiltered(none)).toBe(false);
    expect(isFiltered({ ...none, attachments: true })).toBe(true);
  });
});

describe('shownBoxes', () => {
  it('leaves hidden accounts out of the views across accounts', () => {
    expect(shownBoxes({ kind: 'unified' }, accounts, ['b'])).toEqual([{ account: 'a', mailbox: 'INBOX' }]);
  });

  it('shows a mailbox of a hidden account', () => {
    const view = { kind: 'mailbox', account: 'b', mailbox: 'Archive' } as const;
    expect(shownBoxes(view, accounts, ['b'])).toEqual([view]);
  });

  it('shows every account when all of them are hidden', () => {
    expect(shownBoxes({ kind: 'unified' }, accounts, ['a', 'b'])).toHaveLength(2);
  });
});
