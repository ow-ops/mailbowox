import Storage from 'expo-sqlite/kv-store';

// Synchronous so stores have their saved state on the first frame.
export const readItem = (key: string) => Storage.getItemSync(key);
export const writeItem = (key: string, value: string) => Storage.setItemSync(key, value);
export const removeItem = (key: string) => Storage.removeItemSync(key);
