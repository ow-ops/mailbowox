import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import type { Draft } from '@/core';
import i18n from '@/i18n';
import { enqueueMessage, getQueuedMessages } from '@/mail/outbox-db';
import { explainSendError, restoreError } from '@/core/errors';
import { cancelQueued, flushOutbox, holdMessage, releaseMessage, sendAgain, useFlushOutbox } from '@/mail/outbox';
import { isOnline } from '@/utils/network';

jest.mock('expo-sqlite', () => jest.requireActual('../jest/expo-sqlite'));
jest.mock('@/utils/network', () => ({ isOnline: jest.fn(() => true), useOnline: () => true }));
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
const online = isOnline as jest.Mock;

const draft = (subject: string): Draft => ({
  from: { email: 'me@example.com' },
  to: [{ email: 'you@example.com' }],
  cc: [],
  bcc: [],
  subject,
  text: 'hello',
  references: [],
  attachments: [{ filename: 'note.bin', mimeType: 'application/octet-stream', data: new Uint8Array([1, 2, 3]).buffer }],
});

const explained = (stored: string | null) => stored && explainSendError(restoreError(stored));

const summaryOf = (stored: string | null) => (stored ? explainSendError(restoreError(stored)).summary : null);

const subjects = async () => (await getQueuedMessages()).map((message) => message.draft.subject);

const failure = (tag: string) => Object.assign(new Error(tag), { tag });

beforeEach(async () => {
  online.mockReturnValue(true);
  core.sendMessage.mockReset();
  for (const { id } of await getQueuedMessages()) await cancelQueued(id);
});

describe('flushOutbox', () => {
  it('sends queued messages oldest first, attachments included, and empties the queue', async () => {
    await enqueueMessage('a', draft('first'));
    await enqueueMessage('a', draft('second'));
    core.sendMessage.mockResolvedValue(new Uint8Array());

    await flushOutbox();

    const sent = core.sendMessage.mock.calls.map(([, sentDraft]: [unknown, Draft]) => sentDraft);
    expect(sent.map((d) => d.subject)).toEqual(['first', 'second']);
    expect(new Uint8Array(sent[0].attachments[0].data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await subjects()).toEqual([]);
  });

  it('keeps everything queued when the connection drops mid-run', async () => {
    await enqueueMessage('a', draft('first'));
    await enqueueMessage('a', draft('second'));
    core.sendMessage.mockRejectedValue(failure('Network'));

    await flushOutbox();

    expect(core.sendMessage).toHaveBeenCalledTimes(1);
    expect(await subjects()).toEqual(['first', 'second']);
  });

  it('records why a message was refused and still sends the next one', async () => {
    await enqueueMessage('a', draft('refused'));
    await enqueueMessage('a', draft('fine'));
    core.sendMessage.mockRejectedValueOnce(failure('Invalid')).mockResolvedValue(new Uint8Array());

    await flushOutbox();

    const left = await getQueuedMessages();
    expect(left.map((message) => [message.draft.subject, explained(message.error)])).toEqual([
      ['refused', { summary: "Part of the message isn't valid.", detail: 'Invalid' }],
    ]);
  });
});

describe('flushOutbox when sending may have succeeded', () => {
  const queueOne = async (subject: string) => {
    await enqueueMessage('a', draft(subject));
  };

  it('holds a message the server never confirmed, and sends it again only when asked', async () => {
    await queueOne('maybe sent');
    core.sendMessage.mockRejectedValueOnce(failure('Unconfirmed')).mockResolvedValue(new Uint8Array());

    await flushOutbox();
    await flushOutbox();

    expect(core.sendMessage).toHaveBeenCalledTimes(1);
    const [left] = await getQueuedMessages();
    expect(summaryOf(left.error)).toMatch(/Send it again only if the recipients didn't get it/);

    await sendAgain(left.id);

    expect(core.sendMessage).toHaveBeenCalledTimes(2);
    expect(await subjects()).toEqual([]);
  });

  it('marks a message as possibly sent while it goes out, so an app stopped mid-send holds it', async () => {
    await queueOne('interrupted');
    let during: string | null = null;
    core.sendMessage.mockImplementation(async () => {
      [{ error: during }] = await getQueuedMessages();
      return new Uint8Array();
    });

    await flushOutbox();

    expect(summaryOf(during)).toMatch(/connection dropped before the server confirmed it/);
    expect(await subjects()).toEqual([]);
  });

  it('keeps the earlier failure of a message the connection dropped before sending', async () => {
    await queueOne('refused before');
    core.sendMessage.mockRejectedValueOnce(failure('Protocol')).mockRejectedValue(failure('Network'));

    await flushOutbox();
    await flushOutbox();

    const [left] = await getQueuedMessages();
    expect(summaryOf(left.error)).toBe("The server didn't accept it.");
  });
});

describe('flushOutbox errors', () => {
  it('records a certificate failure instead of waiting silently', async () => {
    await enqueueMessage('a', draft('bad certificate'));
    core.sendMessage.mockRejectedValue(failure('Tls'));

    await flushOutbox();

    const [left] = await getQueuedMessages();
    expect(explained(left.error)).toEqual({ summary: "Couldn't set up a secure connection to the server.", detail: 'Tls' });
  });
});

describe('outbox errors in French', () => {
  beforeAll(() => i18n.changeLanguage('fr'));
  afterAll(() => i18n.changeLanguage('en'));

  it('explains a refused message in the language it is shown in, keeping the server reply', async () => {
    await enqueueMessage('a', draft('refusé'));
    core.sendMessage.mockRejectedValue(failure('Protocol'));

    await flushOutbox();

    const [left] = await getQueuedMessages();
    expect(explained(left.error)).toEqual({ summary: 'Le serveur ne l’a pas accepté.', detail: 'Protocol' });
  });
});

describe('useFlushOutbox', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: new QueryClient() }, children);

  it('retries a message the server could not take after 30 seconds, then backs off', async () => {
    await enqueueMessage('a', draft('later'));
    core.sendMessage.mockRejectedValue(failure('Network'));

    const { unmount } = await renderHook(useFlushOutbox, { wrapper });
    await waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1));
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(core.sendMessage).toHaveBeenCalledTimes(2);
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(core.sendMessage).toHaveBeenCalledTimes(2);
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(core.sendMessage).toHaveBeenCalledTimes(3);
    await unmount();
  });
});

describe('flushOutbox while the user cancels', () => {
  it('does not send a message cancelled while an earlier one was sending', async () => {
    await enqueueMessage('a', draft('first'));
    await enqueueMessage('a', draft('cancelled'));
    const [, cancelled] = await getQueuedMessages();
    let accept = () => {};
    core.sendMessage.mockImplementationOnce(() => new Promise((resolve) => (accept = () => resolve(new Uint8Array()))));

    const flushing = flushOutbox();
    await waitFor(() => expect(core.sendMessage).toHaveBeenCalledTimes(1));
    await cancelQueued(cancelled.id);
    accept();
    await flushing;

    expect(core.sendMessage).toHaveBeenCalledTimes(1);
    expect(await subjects()).toEqual([]);
  });

  it('shares one run between concurrent flushes', async () => {
    await enqueueMessage('a', draft('once'));
    core.sendMessage.mockResolvedValue(new Uint8Array());

    await Promise.all([flushOutbox(), flushOutbox()]);

    expect(core.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('holdMessage', () => {
  it('keeps a message out of the runs until it is released', async () => {
    core.sendMessage.mockResolvedValue(new Uint8Array());
    const id = await holdMessage('a', draft('held'));

    await flushOutbox();
    expect(core.sendMessage).not.toHaveBeenCalled();

    await releaseMessage(id);
    expect(core.sendMessage).toHaveBeenCalledTimes(1);
    expect(await subjects()).toEqual([]);
  });

  it('sends the messages queued around a held one', async () => {
    core.sendMessage.mockResolvedValue(new Uint8Array());
    await holdMessage('a', draft('held'));
    await enqueueMessage('a', draft('free'));

    await flushOutbox();

    expect(await subjects()).toEqual(['held']);
  });
});

describe('cancelQueued', () => {
  it('removes the message so it is never sent', async () => {
    await enqueueMessage('a', draft('cancelled'));
    const [{ id }] = await getQueuedMessages();

    await cancelQueued(id);
    await flushOutbox();

    expect(core.sendMessage).not.toHaveBeenCalled();
  });
});
