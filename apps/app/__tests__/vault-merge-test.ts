import type { SyncedAccount } from '@/accounts/store';
import { mergeDocuments, type VaultDocument } from '@/vault/document';

const account = (email: string, password = 'pw'): SyncedAccount => ({
  email,
  displayName: '',
  imap: { host: 'imap.example.com', port: 993, security: 'tls' },
  smtp: { host: 'smtp.example.com', port: 465, security: 'tls' },
  credentials: { username: email, password },
});

const doc = (accounts: VaultDocument['accounts'], prefsAt = 0): VaultDocument => ({
  accounts,
  prefs: {
    updatedAt: prefsAt,
    value: { remoteContent: prefsAt ? 'never' : 'ask', conversations: true, inboxCategories: true, relayUrl: '', relayToken: '', accountColors: {}, remoteSenders: [] },
  },
});

describe('mergeDocuments', () => {
  it('carries identities with the newest copy of an account', () => {
    const identities = [{ email: 'hello@x', name: 'Hello' }];
    const { document } = mergeDocuments(
      doc({ 'a@x': { updatedAt: 2, account: { ...account('a@x'), identities } } }),
      doc({ 'a@x': { updatedAt: 1, account: account('a@x') } }),
    );
    expect(document.accounts['a@x'].account?.identities).toEqual(identities);
  });

  it('lets a newer remote copy drop identities that were removed', () => {
    const { document } = mergeDocuments(
      doc({ 'a@x': { updatedAt: 1, account: { ...account('a@x'), identities: [{ email: 'hello@x' }] } } }),
      doc({ 'a@x': { updatedAt: 2, account: { ...account('a@x'), identities: [] } } }),
    );
    expect(document.accounts['a@x'].account?.identities).toEqual([]);
  });

  it('keeps accounts from both sides', () => {
    const { document, changed } = mergeDocuments(
      doc({ 'a@x': { updatedAt: 1, account: account('a@x') } }),
      doc({ 'b@x': { updatedAt: 1, account: account('b@x') } }),
    );
    expect(Object.keys(document.accounts).sort()).toEqual(['a@x', 'b@x']);
    expect(changed).toBe(true);
  });

  it('takes the newest change per account', () => {
    const { document } = mergeDocuments(
      doc({ 'a@x': { updatedAt: 2, account: account('a@x', 'new') }, 'b@x': { updatedAt: 1, account: account('b@x', 'old') } }),
      doc({ 'a@x': { updatedAt: 1, account: account('a@x', 'old') }, 'b@x': { updatedAt: 3, account: account('b@x', 'new') } }),
    );
    expect(document.accounts['a@x'].account?.credentials.password).toBe('new');
    expect(document.accounts['b@x'].account?.credentials.password).toBe('new');
  });

  it('lets a newer removal win over an older account and a newer account over an older removal', () => {
    const { document } = mergeDocuments(
      doc({ 'a@x': { updatedAt: 5, account: null }, 'b@x': { updatedAt: 5, account: account('b@x') } }),
      doc({ 'a@x': { updatedAt: 4, account: account('a@x') }, 'b@x': { updatedAt: 4, account: null } }),
    );
    expect(document.accounts['a@x'].account).toBeNull();
    expect(document.accounts['b@x'].account?.email).toBe('b@x');
  });

  it('reports no change when the remote copy already has everything', () => {
    const remote = doc({ 'a@x': { updatedAt: 2, account: account('a@x') } }, 3);
    const { document, changed } = mergeDocuments(doc({ 'a@x': { updatedAt: 2, account: account('a@x') } }, 1), remote);
    expect(changed).toBe(false);
    expect(document).toEqual(remote);
  });

  it('takes the newer prefs', () => {
    expect(mergeDocuments(doc({}, 2), doc({}, 0)).document.prefs.value.remoteContent).toBe('never');
    expect(mergeDocuments(doc({}, 0), doc({}, 2)).changed).toBe(false);
  });
});
