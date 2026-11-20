import { pingAccount } from '@/push/payload';

jest.mock('@/accounts/store', () => ({ getAccounts: () => [] }));

describe('pingAccount', () => {
  it('reads the account hash from the data string on both platforms', () => {
    const dataString = JSON.stringify({ account: 'ab12', unread: 3 });
    expect(pingAccount({ dataString })).toBe('ab12');
    expect(pingAccount({ body: { account: 'ab12', unread: 3 }, dataString })).toBe('ab12');
  });

  it('ignores anything else', () => {
    expect(pingAccount(null)).toBeNull();
    expect(pingAccount({})).toBeNull();
    expect(pingAccount({ dataString: 'not json' })).toBeNull();
    expect(pingAccount({ dataString: JSON.stringify({ unread: 1 }) })).toBeNull();
  });
});
