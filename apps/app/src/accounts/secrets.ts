import { deleteSecret, getSecret, setSecret } from '@/utils/secret-store';

const key = (accountId: string) => `password.${accountId}`;

export const getPassword = (accountId: string) => getSecret(key(accountId));
export const setPassword = (accountId: string, password: string) => setSecret(key(accountId), password);
export const removePassword = (accountId: string) => deleteSecret(key(accountId));
