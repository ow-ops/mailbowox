import { core } from '@/core';
import { holdMessage, releaseMessage } from '@/mail/outbox';
import type { StoredItem } from '@/mail/refs';
import { unsubscribe, unsubscribeMethods } from '@/mail/unsubscribe';

jest.mock('@/core', () => ({ core: { unsubscribeOneClick: jest.fn() } }));
jest.mock('@/mail/outbox', () => ({ holdMessage: jest.fn(async () => 7), releaseMessage: jest.fn() }));
jest.mock('@/accounts/store', () => ({
  getAccounts: () => [{ id: 'a1', email: 'me@example.com', displayName: 'Me' }],
}));

const list = ['mailto:leave@list.example?subject=stop%20please&body=Remove+me', 'https://list.example/u?id=1'];

describe('unsubscribeMethods', () => {
  it('posts first when the list offers one click, then mails, then opens the page', () => {
    expect(unsubscribeMethods({ listUnsubscribe: list, listUnsubscribeOneClick: true })).toEqual([
      { kind: 'oneClick', url: 'https://list.example/u?id=1' },
      { kind: 'mail', to: 'leave@list.example', subject: 'stop please', text: 'Remove me' },
      { kind: 'web', url: 'https://list.example/u?id=1' },
    ]);
  });

  it('never posts to a list that did not ask for one click', () => {
    expect(unsubscribeMethods({ listUnsubscribe: list, listUnsubscribeOneClick: false }).map((m) => m.kind)).toEqual([
      'mail',
      'web',
    ]);
  });

  it('asks a mail-only list to unsubscribe in the subject', () => {
    expect(unsubscribeMethods({ listUnsubscribe: ['mailto:leave@list.example'], listUnsubscribeOneClick: false })).toEqual([
      { kind: 'mail', to: 'leave@list.example', subject: 'unsubscribe', text: '' },
    ]);
  });

  it('offers nothing for a message that is not from a list', () => {
    expect(unsubscribeMethods({ listUnsubscribe: [], listUnsubscribeOneClick: false })).toEqual([]);
    expect(unsubscribeMethods({ listUnsubscribe: ['http://list.example/u'], listUnsubscribeOneClick: true })).toEqual([]);
  });
});

describe('unsubscribe', () => {
  const item = {
    account: 'a1',
    summary: { to: [{ email: 'me@example.com' }], cc: [], deliveredTo: [] },
  } as unknown as StoredItem;
  const methods = unsubscribeMethods({ listUnsubscribe: list, listUnsubscribeOneClick: true });

  beforeEach(() => jest.clearAllMocks());

  it('stops at the one-click post when the list takes it', async () => {
    await expect(unsubscribe(item, methods)).resolves.toBe('done');
    expect(core.unsubscribeOneClick).toHaveBeenCalledWith('https://list.example/u?id=1');
    expect(holdMessage).not.toHaveBeenCalled();
  });

  it('mails the list from the address it wrote to when the post fails', async () => {
    jest.mocked(core.unsubscribeOneClick).mockRejectedValueOnce(new Error('status 500'));
    await expect(unsubscribe(item, methods)).resolves.toBe('done');
    expect(holdMessage).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        from: { name: 'Me', email: 'me@example.com' },
        to: [{ email: 'leave@list.example' }],
        subject: 'stop please',
      }),
    );
    expect(releaseMessage).toHaveBeenCalledWith(7);
  });
});
