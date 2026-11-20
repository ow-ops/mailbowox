import { decodeDocument, encodeDocument, mergeDocuments } from '@/vault/document';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const server = { host: 'imap.example.com', port: 993, security: 'tls' };

const stored = {
  accounts: {
    'a@x': {
      updatedAt: 3,
      account: {
        email: 'a@x',
        displayName: 'A',
        imap: server,
        smtp: { ...server, host: 'smtp.example.com' },
        credentials: { username: 'a@x', password: 'pw' },
      },
    },
    'b@x': { updatedAt: 4, account: null },
  },
  prefs: { updatedAt: 5, value: { remoteContent: 'never', conversations: false, relayUrl: '', relayToken: '' } },
};

describe('vault document', () => {
  it('reads a document without a version', () => {
    const document = decodeDocument(bytes(stored));
    expect(document.accounts['a@x'].account?.credentials.password).toBe('pw');
    expect(document.accounts['b@x'].account).toBeNull();
  });

  it('fills in prefs that older documents lack', () => {
    expect(decodeDocument(bytes(stored)).prefs.value.accountColors).toEqual({});
  });

  it('round-trips through encode', () => {
    const document = decodeDocument(bytes(stored));
    expect(decodeDocument(encodeDocument(document))).toEqual(document);
  });

  it('writes a version', () => {
    const written = JSON.parse(new TextDecoder().decode(encodeDocument(decodeDocument(bytes(stored)))));
    expect(written.version).toBe(1);
  });

  it('keeps account fields this version does not know', () => {
    const account = { ...stored.accounts['a@x'].account, calendarColour: 'red' };
    const document = decodeDocument(bytes({ ...stored, accounts: { 'a@x': { updatedAt: 1, account } } }));
    expect(document.accounts['a@x'].account).toMatchObject({ calendarColour: 'red' });
  });

  it('reads a pref value added by a newer app as the default', () => {
    const prefs = { ...stored.prefs, value: { ...stored.prefs.value, remoteContent: 'always' } };
    expect(decodeDocument(bytes({ ...stored, prefs })).prefs.value.remoteContent).toBe('ask');
  });

  it('keeps top-level fields this version does not know through a merge', () => {
    const remote = decodeDocument(bytes({ ...stored, calendars: { shared: true } }));
    const local = decodeDocument(bytes(stored));
    const { document } = mergeDocuments(local, remote);
    expect(JSON.parse(new TextDecoder().decode(encodeDocument(document)))).toMatchObject({ calendars: { shared: true } });
  });

  it('refuses a newer version with an explanation', () => {
    expect(() => decodeDocument(bytes({ ...stored, version: 2 }))).toThrow(/newer version/);
  });

  it.each([
    ['not JSON', new TextEncoder().encode('{')],
    ['missing accounts', bytes({ prefs: stored.prefs })],
    ['a wrong field type', bytes({ ...stored, accounts: { 'a@x': { updatedAt: 'now', account: null } } })],
  ])('rejects a document that is %s', (_, input) => {
    expect(() => decodeDocument(input)).toThrow(/format/);
  });
});
