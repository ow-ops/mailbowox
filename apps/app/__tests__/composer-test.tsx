import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { getDocumentAsync } from 'expo-document-picker';

import { Composer } from '@/components/composer';
import { readLocalDraft } from '@/mail/local-drafts';
import { saveDraft } from '@/mail/send';
import { sendWithUndo } from '@/mail/undo-send';
import { renderWithQueries } from '../jest/render';

jest.mock('@mailbowox/core-native', () => ({}));
jest.mock('expo-router', () => jest.requireActual('../jest/expo-router'));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
const mockAccount: { id: string; email: string; displayName: string; signature?: string } = {
  id: 'a',
  email: 'me@example.org',
  displayName: 'Me',
};
jest.mock('@/accounts/store', () => ({
  useAccounts: () => [mockAccount],
  getAccount: () => ({ id: 'a' }),
}));
jest.mock('@/contacts/queries', () => ({ useContactAddresses: () => ({ data: [] }) }));
jest.mock('@/mail/queries', () => ({ useSeenAddresses: () => ({ data: [] }) }));
jest.mock('@/mail/send', () => ({ saveDraft: jest.fn() }));
jest.mock('@/mail/forward', () => ({ fetchForwarded: jest.fn() }));
jest.mock('@/mail/undo-send', () => ({ sendWithUndo: jest.fn() }));
jest.mock('@/mail/from', () => ({ ...jest.requireActual('@/mail/from'), setLastFrom: jest.fn() }));
jest.mock('@/mail/store', () => jest.requireActual('../jest/mail-store'));
jest.mock('@/utils/kv', () => {
  const items = new Map<string, string>();
  return {
    readItem: (key: string) => items.get(key) ?? null,
    writeItem: (key: string, value: string) => items.set(key, value),
    clear: () => items.clear(),
  };
});

const { router } = jest.requireMock<typeof import('../jest/expo-router')>('expo-router');

const sender = { account: 'a', address: { name: 'Me', email: 'me@example.org' } };

beforeEach(() => {
  jest.clearAllMocks();
  delete mockAccount.signature;
  jest.requireMock<{ clear: () => void }>('@/utils/kv').clear();
  jest.requireMock<typeof import('../jest/mail-store')>('@/mail/store').store.clear();
});

// The buttons of the last Alert, by label.
const alertButtons = (alert: jest.SpyInstance) =>
  Object.fromEntries((alert.mock.lastCall[2] as AlertButton[]).map((button) => [button.text, button]));

describe('composer', () => {
  it('cannot send until there is a valid recipient', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} />);
    const send = () => screen.getByRole('button', { name: 'Send' });

    expect(send()).toBeDisabled();

    await user.type(screen.getByLabelText('To'), 'nobody,');
    expect(send()).toBeDisabled();

    await user.press(screen.getByRole('button', { name: 'nobody is not a valid address. Remove it.' }));
    await user.type(screen.getByLabelText('To'), 'bob@example.org,');
    expect(send()).toBeEnabled();
  });

  it('counts an address typed but not yet turned into a chip', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} />);

    await user.type(screen.getByLabelText('To'), 'bob@example.org', { skipBlur: true });

    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('sends the draft from the picked sender and leaves the screen', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} recipient={{ email: 'bob@example.org' }} />);
    await user.type(screen.getByLabelText('Subject'), 'Hello');
    await user.type(screen.getByLabelText('Message'), 'Count me in.');

    await user.press(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(sendWithUndo).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        from: sender.address,
        to: [{ email: 'bob@example.org' }],
        subject: 'Hello',
        text: 'Count me in.',
      }),
      expect.any(Function),
    );
  });

  it('reveals Cc and Bcc on request', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} />);
    expect(screen.queryByLabelText('Cc')).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Add Cc or Bcc' }));

    expect(screen.getByLabelText('Cc')).toBeOnTheScreen();
    expect(screen.getByLabelText('Bcc')).toBeOnTheScreen();
  });

  it('closes at once when untouched, and asks before throwing edits away', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} />);

    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.back).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('Subject'), 'Hello');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(alert).toHaveBeenCalledWith('Save this message as a draft?', undefined, expect.any(Array));
    expect(Object.keys(alertButtons(alert))).toEqual(['Keep editing', 'Discard', 'Save draft']);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('saves to the server Drafts from the close prompt', async () => {
    (saveDraft as jest.Mock).mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} />);
    await user.type(screen.getByLabelText('Subject'), 'Later');

    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    alertButtons(alert)['Save draft'].onPress?.();

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(saveDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ subject: 'Later' }));
  });

  it('keeps a copy on the device shortly after typing stops', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Composer sender={sender} />);

    await user.type(screen.getByLabelText('Subject'), 'Crash-proof');

    await waitFor(() => expect(readLocalDraft('new/')?.subject).toBe('Crash-proof'));
  });

  it('brings back what was typed when the composer opens again', async () => {
    const user = userEvent.setup();
    const first = await renderWithQueries(<Composer sender={sender} />);
    await user.type(screen.getByLabelText('To'), 'bob@example.org,');
    await user.type(screen.getByLabelText('Subject'), 'Unfinished');
    await user.type(screen.getByLabelText('Message'), 'Where was I');
    await first.unmount();

    await renderWithQueries(<Composer sender={sender} />);

    expect(screen.getByLabelText('Subject')).toHaveDisplayValue('Unfinished');
    expect(screen.getByLabelText('Message')).toHaveDisplayValue('Where was I');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('brings back the attachments with the draft', async () => {
    (getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ name: 'notes.txt', mimeType: 'text/plain', file: { arrayBuffer: async () => new ArrayBuffer(3) } }],
    });
    const user = userEvent.setup();
    const first = await renderWithQueries(<Composer sender={sender} />);
    await user.press(screen.getByRole('button', { name: 'Attach files' }));
    expect(await screen.findByRole('button', { name: 'Remove notes.txt' })).toBeOnTheScreen();
    await first.unmount();

    await renderWithQueries(<Composer sender={sender} />);

    expect(await screen.findByRole('button', { name: 'Remove notes.txt' })).toBeOnTheScreen();
  });

  it('keeps a separate copy for each message being written', async () => {
    const user = userEvent.setup();
    const first = await renderWithQueries(<Composer sender={sender} />);
    await user.type(screen.getByLabelText('Subject'), 'New one');
    await first.unmount();

    await renderWithQueries(<Composer sender={sender} recipient={{ email: 'bob@example.org' }} />);

    expect(screen.getByLabelText('Subject')).toHaveDisplayValue('');
  });

  it('forgets the kept copy once the message is sent', async () => {
    const user = userEvent.setup();
    const first = await renderWithQueries(<Composer sender={sender} recipient={{ email: 'bob@example.org' }} />);
    await user.type(screen.getByLabelText('Subject'), 'Done');
    await user.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    await first.unmount();

    await renderWithQueries(<Composer sender={sender} recipient={{ email: 'bob@example.org' }} />);

    expect(screen.getByLabelText('Subject')).toHaveDisplayValue('');
  });

  it('opens again with the message and its attachments when the send is undone', async () => {
    (getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ name: 'notes.txt', mimeType: 'text/plain', file: { arrayBuffer: async () => new ArrayBuffer(3) } }],
    });
    const user = userEvent.setup();
    const first = await renderWithQueries(<Composer sender={sender} recipient={{ email: 'bob@example.org' }} />);
    await user.type(screen.getByLabelText('Subject'), 'Too soon');
    await user.press(screen.getByRole('button', { name: 'Attach files' }));
    await screen.findByRole('button', { name: 'Remove notes.txt' });
    await user.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    await first.unmount();

    (sendWithUndo as jest.Mock).mock.lastCall[2]();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/compose', params: { to: 'bob@example.org' } });
    await renderWithQueries(<Composer sender={sender} recipient={{ email: 'bob@example.org' }} />);

    expect(screen.getByLabelText('Subject')).toHaveDisplayValue('Too soon');
    expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeOnTheScreen();
  });

  it('starts a message with the signature of the sending account', async () => {
    mockAccount.signature = 'Me\nexample.org';
    await renderWithQueries(<Composer sender={sender} />);

    expect(screen.getByLabelText('Message')).toHaveDisplayValue('\n\n-- \nMe\nexample.org');
  });

  it('forgets the kept copy when the message is discarded', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    const first = await renderWithQueries(<Composer sender={sender} />);
    await user.type(screen.getByLabelText('Subject'), 'Never mind');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    alertButtons(alert).Discard.onPress?.();
    await first.unmount();

    await renderWithQueries(<Composer sender={sender} />);

    expect(screen.getByLabelText('Subject')).toHaveDisplayValue('');
  });
});
