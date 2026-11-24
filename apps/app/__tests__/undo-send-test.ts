import { waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import type { Draft } from '@/core';
import { store } from '../jest/mail-store';
import { cancelQueued } from '@/mail/outbox';
import { sendWithUndo } from '@/mail/undo-send';
import { showError, showToast } from '@/utils/toast';

jest.mock('@/mail/store', () => jest.requireActual('../jest/mail-store'));
jest.mock('@/utils/network', () => ({ isOnline: jest.fn(() => true), useOnline: () => true }));
jest.mock('@/utils/toast', () => ({ showToast: jest.fn(() => 1), dismissToast: jest.fn(), showError: jest.fn() }));
jest.mock('@/utils/query-client', () => ({ invalidateMail: jest.fn() }));
jest.mock('@/hooks/use-app-active', () => ({ useAppActive: () => true }));
jest.mock('@/mail/session', () => ({ withSession: jest.fn() }));
jest.mock('@/mail/sync', () => ({ syncMailbox: jest.fn(), useSyncErrors: () => ({}) }));
jest.mock('@/accounts/store', () => ({
  accountConfig: async () => ({}),
  getAccount: (id: string) => ({ id }),
}));
jest.mock('@/core', () => ({ core: { sendMessage: jest.fn() } }));

const { core } = jest.requireMock<{ core: { sendMessage: jest.Mock } }>('@/core');
const { isOnline } = jest.requireMock<{ isOnline: jest.Mock }>('@/utils/network');

const draft: Draft = {
  from: { email: 'me@example.com' },
  to: [{ email: 'you@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Hello',
  text: 'hello',
  references: [],
  attachments: [],
};

const queued = async () => (await store.queuedMessages()).length;
const toasts = () => (showToast as jest.Mock).mock.calls.map(([message]) => message);
const pressUndo = () => (showToast as jest.Mock).mock.calls[0][1].onClick();
const windowPasses = () => jest.advanceTimersByTimeAsync(5000);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  isOnline.mockReturnValue(true);
  core.sendMessage.mockReset().mockResolvedValue(new Uint8Array());
  for (const { id } of await store.queuedMessages()) await cancelQueued(id);
});

afterEach(() => jest.useRealTimers());

describe('sendWithUndo', () => {
  it('waits five seconds before sending', async () => {
    const reopen = jest.fn();
    await sendWithUndo('a', draft, reopen);
    expect(toasts()).toEqual(['Sending…']);

    await jest.advanceTimersByTimeAsync(4000);
    expect(core.sendMessage).not.toHaveBeenCalled();

    await windowPasses();
    await waitFor(() => expect(toasts()).toEqual(['Sending…', 'Sent']));
    expect(core.sendMessage).toHaveBeenCalledTimes(1);
    expect(reopen).not.toHaveBeenCalled();
  });

  it('takes the message back on Undo and never sends it', async () => {
    const reopen = jest.fn();
    await sendWithUndo('a', draft, reopen);

    pressUndo();
    await waitFor(() => expect(reopen).toHaveBeenCalled());
    await windowPasses();

    expect(core.sendMessage).not.toHaveBeenCalled();
    expect(await queued()).toBe(0);
  });

  it('sends at once when the app goes to the background', async () => {
    const listen = jest.spyOn(AppState, 'addEventListener');
    await sendWithUndo('a', draft, jest.fn());

    listen.mock.lastCall?.[1]('background');

    await waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1));
  });

  it('ignores Undo once the message is on its way', async () => {
    const reopen = jest.fn();
    await sendWithUndo('a', draft, reopen);
    await windowPasses();

    pressUndo();

    await waitFor(() => expect(toasts()).toContain('Sent'));
    expect(reopen).not.toHaveBeenCalled();
  });

  it('keeps the message in the outbox while there is no connection', async () => {
    isOnline.mockReturnValue(false);
    await sendWithUndo('a', draft, jest.fn());

    await windowPasses();

    await waitFor(() => expect(toasts()).toHaveLength(2));
    expect(toasts()[1]).toMatch(/No connection/);
    expect(await queued()).toBe(1);
  });

  it('hands a message the server refused back to the composer, with the reason', async () => {
    core.sendMessage.mockRejectedValue(Object.assign(new Error('Invalid'), { tag: 'Invalid' }));
    const reopen = jest.fn();
    await sendWithUndo('a', draft, reopen);

    await windowPasses();

    await waitFor(() => expect(reopen).toHaveBeenCalled());
    expect(showError).toHaveBeenCalledWith("Couldn't send", "Part of the message isn't valid.");
    expect(await queued()).toBe(0);
  });
});
