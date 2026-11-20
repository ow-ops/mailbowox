import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { RelayForm } from '@/components/relay-settings';
import { core } from '@/core';
import { setPref } from '@/prefs/store';
import { renderWithQueries } from '../jest/render';

jest.mock('@/core', () => ({ core: { configureRelay: jest.fn() } }));
jest.mock('@/prefs/store', () => ({ usePref: () => '', setPref: jest.fn() }));
jest.mock('expo-router', () => ({}));

const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

async function save(url: string) {
  const onSaved = jest.fn();
  const user = userEvent.setup();
  await renderWithQueries(<RelayForm submitLabel="Continue" variant="primary" onSaved={onSaved} />);
  await user.type(screen.getByLabelText('Relay address'), url);
  await user.type(screen.getByLabelText('Access code'), 'code');
  await user.press(screen.getByRole('button', { name: 'Continue' }));
  return onSaved;
}

describe('relay form', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves a relay once its health check answers', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const onSaved = await save('https://relay.example/mail');

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example/mail/healthz');
    expect(core.configureRelay).toHaveBeenCalledWith('https://relay.example/mail', 'code');
    expect(setPref).toHaveBeenCalledWith('relayToken', 'code');
  });

  it('keeps the old relay when the new address does not answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onSaved = await save('https://nothing.example');

    expect(await screen.findByText(/Nothing answered at https:\/\/nothing.example/)).toBeOnTheScreen();
    expect(core.configureRelay).not.toHaveBeenCalled();
    expect(setPref).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says what Continue is waiting for', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<RelayForm submitLabel="Continue" variant="primary" onSaved={jest.fn()} />);
    expect(screen.getByText('Enter the relay address to continue.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Relay address'), 'https://relay.example');
    expect(screen.getByText('Enter the access code to continue.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('asks for a web address before trying to reach it', async () => {
    await save('relay.example');

    expect(await screen.findByText(/starting with https:\/\//)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
