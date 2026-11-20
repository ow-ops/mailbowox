import { core } from '@/core';

jest.mock('@mailbowox/core-native', () => {
  // The shape UniFFI gives a CoreError: the variant name as the message, the core's text in `inner`.
  const coreError = (tag: string, message: string, reason?: string) =>
    Object.assign(new Error('CoreError'), { tag, inner: { message, reason } });
  // Enough of each binding enum for the value tables this module builds when it loads.
  const anyEnum = new Proxy({}, { get: (_, member) => member });
  return {
    Security: anyEnum,
    MailboxRole: anyEnum,
    TlsFailure: anyEnum,
    verifyOutgoing: () => Promise.reject(coreError('Tls', 'invalid peer certificate: Expired', 'Certificate')),
    verifyIncoming: () => Promise.reject(coreError('Protocol', 'unexpected greeting from the server')),
    configureRelay: () => {
      throw coreError('Invalid', 'relay URL must be http or https');
    },
  };
});

const config = {
  email: 'a@example.org',
  displayName: '',
  imap: { host: 'h', port: 993, security: 'tls' as const },
  smtp: { host: 'h', port: 465, security: 'tls' as const },
  credentials: { username: 'a', password: 'p' },
};

describe('core errors', () => {
  it('carry the explanation from the core as their message, and keep their variant', async () => {
    await expect(core.verifyIncoming(config)).rejects.toMatchObject({
      tag: 'Protocol',
      message: 'unexpected greeting from the server',
    });
  });

  it('say why TLS failed', async () => {
    await expect(core.verifyOutgoing(config)).rejects.toMatchObject({ tag: 'Tls', reason: 'certificate' });
  });

  it('are explained for synchronous calls too', () => {
    expect(() => core.configureRelay('ftp://x', 't')).toThrow('relay URL must be http or https');
  });
});
