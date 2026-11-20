import * as SecureStore from 'expo-secure-store';

import { deleteSecret, getSecret, setSecret } from '@/utils/secret-store';


jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const accessible = { keychainAccessible: 'after-first-unlock-this-device-only' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('secret store', () => {
  it('saves new secrets readable after the first unlock', async () => {
    await setSecret('password.a', 'pw');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('password.a', 'pw', accessible);
  });

  it('reads a secret as stored', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('pw');
    expect(await getSecret('password.a')).toBe('pw');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('deletes a secret', async () => {
    await deleteSecret('password.a');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('password.a');
  });
});
