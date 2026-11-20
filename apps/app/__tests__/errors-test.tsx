import { render, screen, userEvent } from '@testing-library/react-native';

import { ErrorExplanation } from '@/components/error-explanation';
import i18n from '@/i18n';
import { errorKind, explainError, explainSendError, restoreError, storeError } from '@/core/errors';

// What the core reports for each case, as seen against a local Stalwart.
const coreError = (tag: string, message: string, reason?: string) => Object.assign(new Error(message), { tag, reason });

describe('errorKind', () => {
  it.each([
    ['TLS on a plain-text port', coreError('Tls', 'received corrupt message of type InvalidContentType', 'notTls'), 'plainPort'],
    ['STARTTLS on a server without it', coreError('Tls', 'IMAP STARTTLS failed: NO TLS is not available.', 'startTlsRefused'), 'noStartTls'],
    ['an SMTP server refusing STARTTLS', coreError('Tls', 'SMTP STARTTLS failed: rejected 454 not now', 'startTlsRefused'), 'noStartTls'],
    ['a self-signed certificate', coreError('Tls', 'invalid peer certificate: UnknownIssuer', 'certificate'), 'certificate'],
    ['a handshake cut short', coreError('Tls', 'connection closed during the handshake', 'other'), 'tls'],
    ['a connection dropped during STARTTLS', coreError('Tls', 'IMAP STARTTLS failed: reached unexpected EOF on stream', 'other'), 'tls'],
    ['a closed port', coreError('Network', 'Connection refused (os error 61)'), 'unreachable'],
    ['an unknown host', coreError('Network', 'failed to lookup address information: nodename nor servname provided'), 'unreachable'],
    ['a relay that turns the connection down', coreError('Network', 'the web relay refused mail.example.com:993'), 'relay'],
    ['a wrong password', coreError('Auth', 'authentication failed: [AUTHENTICATIONFAILED]'), 'auth'],
    ['an unexpected server reply', coreError('Protocol', 'unexpected greeting'), 'server'],
    ['a database failure', new Error('cannot commit - no transaction is active'), 'device'],
  ])('tells %s apart', (_, error, kind) => {
    expect(errorKind(error)).toBe(kind);
  });
});

describe('explainError', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('leads with a plain sentence and keeps the raw text as the detail', () => {
    expect(explainError(coreError('Tls', 'received corrupt message of type InvalidContentType', 'notTls'))).toEqual({
      summary: expect.stringContaining('needs STARTTLS'),
      detail: 'received corrupt message of type InvalidContentType',
    });
  });

  it('explains in the user language', async () => {
    await i18n.changeLanguage('fr');

    expect(explainError(coreError('Network', 'Connection refused')).summary).toBe(
      'Impossible de joindre le serveur. Vérifiez votre connexion, ainsi que le nom et le port du serveur.',
    );
  });

  it('copes with something thrown that is not an error', () => {
    expect(explainError('disk full')).toEqual({ summary: "Couldn't read or save data on this device.", detail: 'disk full' });
  });
});

describe('explainSendError', () => {
  it('says the server turned the message down when it answered with an error', () => {
    expect(explainSendError(coreError('Protocol', '550 mailbox unavailable')).summary).toBe("The server didn't accept it.");
  });

  it('explains connection problems like any other failure', () => {
    expect(explainSendError(coreError('Auth', 'bad credentials')).summary).toBe(
      "The server didn't accept the username or password. Some providers need an app password.",
    );
  });
});

describe('stored errors', () => {
  it('keep their kind and text across a restart', () => {
    const error = coreError('Tls', 'invalid peer certificate: Expired', 'certificate');

    expect(explainSendError(restoreError(storeError(error)))).toEqual(explainSendError(error));
  });
});

describe('ErrorExplanation', () => {
  it('keeps the raw detail hidden until asked for', async () => {
    await render(<ErrorExplanation summary="Couldn't reach the server." detail="Connection refused (os error 61)" />);
    expect(screen.queryByText('Connection refused (os error 61)')).toBeNull();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Details', expanded: false }));

    expect(screen.getByText('Connection refused (os error 61)')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Details', expanded: true })).toBeOnTheScreen();
  });

  it('offers no details when there are none', async () => {
    await render(<ErrorExplanation summary="Couldn't reach the server." detail="" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
