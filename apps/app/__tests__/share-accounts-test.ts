import type { SyncedAccount } from '@/accounts/store';
import { decodeSharePart, shareCodes } from '@/accounts/share';

const account = (email: string, signature?: string): SyncedAccount => ({
  email,
  displayName: 'Ada',
  imap: { host: 'imap.example.org', port: 993, security: 'tls' },
  smtp: { host: 'smtp.example.org', port: 465, security: 'tls' },
  credentials: { username: email, password: 'secret' },
  signature,
});

describe('account sharing codes', () => {
  it('round-trips the accounts, passwords included', () => {
    const accounts = [account('a@example.org'), account('b@example.org')];
    const parts = shareCodes(accounts).map(decodeSharePart);
    expect(parts.flatMap((part) => part!.accounts)).toEqual(accounts);
  });

  it('carries an account left without its password', () => {
    const bare = { ...account('a@example.org'), credentials: { username: 'a@example.org', password: '' } };
    expect(decodeSharePart(shareCodes([bare])[0])!.accounts).toEqual([bare]);
  });

  it('splits accounts that do not fit one code, numbering every part of the same set', () => {
    const accounts = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => account(`${name}@example.org`));
    const parts = shareCodes(accounts).map((code) => decodeSharePart(code)!);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.part)).toEqual(parts.map((_, index) => index));
    expect(new Set(parts.map((part) => `${part.set}/${part.parts}`)).size).toBe(1);
    expect(parts.flatMap((part) => part.accounts)).toEqual(accounts);
  });

  it('gives an account too big to share a code one of its own', () => {
    const codes = shareCodes([account('a@example.org'), account('b@example.org', 'x'.repeat(1000))]);
    expect(codes).toHaveLength(2);
  });

  it('ignores QR codes that are not shares', () => {
    expect(decodeSharePart('https://example.org')).toBeNull();
    expect(decodeSharePart(JSON.stringify({ mailbowox: 'link', gateway: 'https://example.org' }))).toBeNull();
    expect(decodeSharePart(JSON.stringify({ mailbowox: 'accounts', set: 'x', part: 2, parts: 2, accounts: [] }))).toBeNull();
  });
});
