export const readItem = (key: string) => globalThis.localStorage?.getItem(key) ?? null;
export const writeItem = (key: string, value: string) => globalThis.localStorage?.setItem(key, value);
export const removeItem = (key: string) => globalThis.localStorage?.removeItem(key);
