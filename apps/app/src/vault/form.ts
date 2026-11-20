export const MIN_PASSPHRASE = 12;

export const validGateway = (url: string) => /^https?:\/\/[^\s/]+/.test(url.trim());
