import { deleteDatabaseAsync } from 'expo-sqlite';

import { removeLegacyData } from '@/mail/legacy';

jest.mock('expo-sqlite', () => ({ deleteDatabaseAsync: jest.fn() }));
jest.mock('@/utils/kv', () => {
  const items = new Map<string, string>();
  return { readItem: (key: string) => items.get(key) ?? null, writeItem: (key: string, value: string) => items.set(key, value) };
});

describe('removeLegacyData', () => {
  it('deletes the old databases once, even when one is already gone', async () => {
    (deleteDatabaseAsync as jest.Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('missing'));
    await removeLegacyData();
    expect(deleteDatabaseAsync).toHaveBeenCalledWith('mail.db');
    expect(deleteDatabaseAsync).toHaveBeenCalledWith('contacts.db');

    await removeLegacyData();
    expect(deleteDatabaseAsync).toHaveBeenCalledTimes(2);
  });
});
