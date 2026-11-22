import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import AddAccountScreen from '@/app/add-account';
import { addAccount, hasAccount } from '@/accounts/store';
import { core } from '@/core';
import { savedRelayRefusesCode } from '@/utils/relay';
import { renderWithQueries } from '../jest/render';

jest.mock('@mailbowox/core-native', () => {
  const anyEnum = new Proxy({}, { get: (_, member) => member });
  return {
    Security: anyEnum,
    MailboxRole: anyEnum,
    TlsFailure: anyEnum,
  };
});
jest.mock('@/core', () => ({
  core: {
    discover: jest.fn(),
    verifyIncoming: jest.fn(),
    verifyOutgoing: jest.fn(),
    discoverContacts: jest.fn(),
  },
}));
jest.mock('@/accounts/store', () => ({
  addAccount: jest.fn(),
  hasAccount: jest.fn(() => false),
  useAccounts: () => [{ id: 'a' }],
}));
jest.mock('@/utils/relay', () => ({ ...jest.requireActual('@/utils/relay'), savedRelayRefusesCode: jest.fn() }));
jest.mock('@/accounts/use-account-color', () => ({ pinAccountColor: jest.fn() }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: jest.fn() } }));

const found = {
  source: 'autoconfig',
  imap: { host: 'imap.example.org', port: 993, security: 'tls' },
  smtp: { host: 'smtp.example.org', port: 465, security: 'tls' },
  username: 'me@example.org',
};

const discover = core.discover as jest.Mock;
const verifyIncoming = core.verifyIncoming as jest.Mock;
const verifyOutgoing = core.verifyOutgoing as jest.Mock;
const discoverContacts = core.discoverContacts as jest.Mock;

const coreError = (tag: string, message: string, reason?: string) => Object.assign(new Error(message), { tag, reason });

async function fill(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(screen.getByLabelText('Email address'), email);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('add account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hasAccount as jest.Mock).mockReturnValue(false);
    verifyIncoming.mockResolvedValue(undefined);
    verifyOutgoing.mockResolvedValue(undefined);
    discoverContacts.mockResolvedValue(undefined);
  });

  it('says what Continue is waiting for until there is a full address and a password', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    const next = () => screen.getByRole('button', { name: 'Continue' });

    expect(next()).toBeDisabled();
    expect(screen.getByText('Enter your email address to continue.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Email address'), 'not-an-address');
    expect(next()).toBeDisabled();
    expect(screen.getByText('Enter a full email address, like name@example.com.')).toBeOnTheScreen();

    await user.clear(screen.getByLabelText('Email address'));
    await user.type(screen.getByLabelText('Email address'), 'me@example.org');
    expect(screen.getByText('Enter your password to continue.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Password'), 'secret');
    expect(next()).toBeEnabled();
    expect(screen.queryByText(/to continue\.$/)).toBeNull();
  });

  it('tells the user when the account is already added', async () => {
    (hasAccount as jest.Mock).mockReturnValue(true);
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');

    expect(screen.getByText('This account is already added.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('shows the discovered servers, then signs in with them', async () => {
    discover.mockResolvedValue(found);
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');

    await user.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/imap.example.org, port 993/)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(addAccount).toHaveBeenCalled());
    const config = expect.objectContaining({
      email: 'me@example.org',
      imap: found.imap,
      smtp: found.smtp,
      credentials: { username: 'me@example.org', password: 'secret' },
    });
    expect(verifyIncoming).toHaveBeenCalledWith(config);
    expect(verifyOutgoing).toHaveBeenCalledWith(config);
  });

  it('blames a refused access code, not the domain, and offers to change the relay', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'web');
    discover.mockResolvedValue(undefined);
    (savedRelayRefusesCode as jest.Mock).mockResolvedValue(true);
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');
    await user.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/relay refused your access code/)).toBeOnTheScreen();
    expect(screen.queryByText(/No settings found/)).toBeNull();
    expect(screen.queryByLabelText('IMAP server')).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Change relay' }));
    expect(await screen.findByLabelText('Access code')).toBeOnTheScreen();
    platform.restore();
  });

  it('labels servers found by guessing, and asks the user to check them', async () => {
    discover.mockResolvedValue({ ...found, source: 'probe' });
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');
    await user.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Found by trying common server names')).toBeOnTheScreen();
    expect(screen.getByText(/Sign in only if they look right/)).toBeOnTheScreen();
  });

  it('fills in the server a probe reached and asks for the other one', async () => {
    discover.mockResolvedValue({ source: 'probe', imap: found.imap, username: found.username });
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');
    await user.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByDisplayValue('imap.example.org')).toBeOnTheScreen();
    expect(screen.getByText('Enter the outgoing mail server.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('asks for the servers by hand when discovery fails, and holds Sign in until they are valid', async () => {
    discover.mockRejectedValue(coreError('Network', 'offline'));
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');
    await user.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Couldn't look up the settings/)).toBeOnTheScreen();
    expect(screen.getByText(/Couldn't reach the server/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByText('Enter the incoming mail server.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('IMAP server'), 'imap.example.org');
    expect(screen.getByText('Enter the outgoing mail server.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('SMTP server'), 'smtp.example.org');
    await user.clear(screen.getByLabelText('SMTP port'));
    expect(screen.getByText('Enter the outgoing mail port, a number from 1 to 65535.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('SMTP port'), '587');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  async function signInWith(settings: object) {
    discover.mockResolvedValue(settings);
    const user = userEvent.setup();
    await renderWithQueries(<AddAccountScreen />);
    await fill(user, 'me@example.org', 'secret');
    await user.press(screen.getByRole('button', { name: 'Continue' }));
    await user.press(await screen.findByRole('button', { name: 'Sign in' }));
  }

  it('says the incoming server rejected the password', async () => {
    verifyIncoming.mockRejectedValue(coreError('Auth', 'no'));
    await signInWith(found);

    expect(await screen.findByText("Incoming mail didn't work with imap.example.org on port 993.")).toBeOnTheScreen();
    expect(screen.getByText(/didn't accept the username or password/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Checking incoming mail: failed')).toBeOnTheScreen();
    expect(verifyOutgoing).not.toHaveBeenCalled();
  });

  it('names the outgoing server when only sending fails', async () => {
    verifyOutgoing.mockRejectedValue(coreError('Network', 'connection refused'));
    await signInWith(found);

    expect(
      await screen.findByText("Incoming mail works, but outgoing mail didn't work with smtp.example.org on port 465."),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Couldn't reach the server/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Checking incoming mail: done')).toBeOnTheScreen();
    expect(screen.getByLabelText('Checking outgoing mail: failed')).toBeOnTheScreen();
    expect(screen.getByLabelText('Finding contacts: waiting')).toBeOnTheScreen();
    expect(addAccount).not.toHaveBeenCalled();
  });

  it('adds the account without contacts when none can be found', async () => {
    discoverContacts.mockRejectedValue(coreError('NotFound', 'no address-book home'));
    await signInWith(found);

    await waitFor(() => expect(addAccount).toHaveBeenCalledWith(expect.anything(), { carddav: undefined }));
  });

  it('stops when a contacts server the settings name does not answer', async () => {
    discoverContacts.mockRejectedValue(coreError('Network', 'timed out'));
    await signInWith({ ...found, carddavUrl: 'https://dav.example.org' });

    expect(await screen.findByText(/contacts server at https:\/\/dav.example.org didn't answer/)).toBeOnTheScreen();
    expect(addAccount).not.toHaveBeenCalled();
  });

  it("keeps the server's own words behind Details", async () => {
    verifyIncoming.mockRejectedValue(coreError('Tls', 'received corrupt message of type InvalidContentType', 'notTls'));
    await signInWith(found);

    expect(await screen.findByText(/doesn't encrypt connections on this port/)).toBeOnTheScreen();
    expect(screen.queryByText(/corrupt message/)).toBeNull();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/corrupt message/)).toBeOnTheScreen();
  });
});
