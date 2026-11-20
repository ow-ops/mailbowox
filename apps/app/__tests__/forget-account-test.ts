import { forgetAccount, sweepRemovedAccounts } from '@/accounts/forget';
import type { Account } from '@/accounts/store';

const mockAccounts: { id: string }[] = [];
let mockReadable = true;
const mockDeleted: string[] = [];

// Each store holds data for 'kept' and for 'gone', and notes whether the account was still listed when
// its data was deleted.
function mockData(name: string) {
  return {
    storedAccounts: async () => ['kept', 'gone'],
    deleteAccountData: async (id: string) => {
      mockDeleted.push(`${name}:${id}:${mockAccounts.some((a) => a.id === id) ? 'listed' : 'unlisted'}`);
    },
  };
}

jest.mock('@/accounts/store', () => ({
  accountExists: (id: string) => mockAccounts.some((a) => a.id === id),
  accountsReadable: () => mockReadable,
  removeAccount: async (id: string) => {
    mockAccounts.splice(0, mockAccounts.length, ...mockAccounts.filter((a) => a.id !== id));
  },
}));
jest.mock('@/mail/db', () => mockData('mail'));
jest.mock('@/contacts/db', () => mockData('contacts'));
jest.mock('@/mail/local-drafts', () => ({ removeAccountDrafts: async () => undefined }));
jest.mock('@/mail/new-mail', () => ({ setNotifyNewMail: async () => undefined }));
jest.mock('@/utils/query-client', () => ({
  invalidateMail: () => undefined,
  invalidateContacts: () => undefined,
}));
jest.mock('@/mail/session', () => ({ closeSession: async () => undefined }));
jest.mock('@/push/register', () => ({ dropPush: async () => undefined }));

beforeEach(() => {
  mockAccounts.splice(0, mockAccounts.length, { id: 'kept' }, { id: 'gone' });
  mockDeleted.length = 0;
  mockReadable = true;
});

describe('forgetAccount', () => {
  it('takes the account off the list before deleting its data, so a sync under way stops writing', async () => {
    await forgetAccount({ id: 'gone' } as Account);

    expect(mockDeleted).toEqual(['mail:gone:unlisted', 'contacts:gone:unlisted']);
  });
});

describe('sweepRemovedAccounts', () => {
  it('deletes what accounts no longer on the device left behind', async () => {
    mockAccounts.splice(1);
    await sweepRemovedAccounts();

    expect(mockDeleted).toEqual(['mail:gone:unlisted', 'contacts:gone:unlisted']);
  });

  it('cleans up after the last account too', async () => {
    mockAccounts.length = 0;
    await sweepRemovedAccounts();

    expect(mockDeleted).toHaveLength(4);
  });

  it('touches nothing when the account list could not be read', async () => {
    mockAccounts.length = 0;
    mockReadable = false;
    await sweepRemovedAccounts();

    expect(mockDeleted).toEqual([]);
  });
});
