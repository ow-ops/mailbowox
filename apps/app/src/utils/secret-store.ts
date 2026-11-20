import * as SecureStore from 'expo-secure-store';

// Background mail sync reads these while the phone is locked, so they must be readable after the first unlock.
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const getSecret = (key: string) => SecureStore.getItemAsync(key);

export const setSecret = (key: string, value: string) => SecureStore.setItemAsync(key, value, options);

export const deleteSecret = (key: string) => SecureStore.deleteItemAsync(key);
