import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { MessageRow } from '@/components/message-row';
import { single, type Conversation, type StoredItem } from '@/mail/refs';
import { conversationKey, stopSelecting, useSelection } from '@/mail/selection';
import { renderWithQueries } from '../jest/render';

jest.mock('@mailbowox/core-native', () => ({}));
jest.mock('expo-router', () => jest.requireActual('../jest/expo-router'));
jest.mock('@/components/swipe-actions', () => ({ SwipeActions: ({ children }: { children: unknown }) => children }));
jest.mock('@/accounts/use-account-color', () => ({ useAccountColor: () => '#c8b8ec' }));
jest.mock('@/mail/actions', () => ({ useMessageActions: jest.fn() }));
jest.mock('@/mail/queries', () => ({ useBlockedCount: () => ({ data: 0 }), useRoleMailbox: () => 'Trash' }));

const useMessageActions = jest.mocked(jest.requireMock<typeof import('@/mail/actions')>('@/mail/actions').useMessageActions);

const actions = { toggleSeen: jest.fn(), toggleFlagged: jest.fn(), archive: jest.fn(), remove: jest.fn() };

function item(overrides: Partial<StoredItem['summary']> = {}, flags = {}): StoredItem {
  return {
    account: 'a',
    mailbox: 'INBOX',
    uid: 1,
    uidValidity: 1,
    thread: 't1',
    summary: {
      from: [{ name: 'Bob', email: 'bob@example.org' }],
      to: [{ email: 'me@example.org' }],
      cc: [],
      subject: 'Quarterly numbers',
      preview: 'The report is ready.',
      date: Math.floor(Date.now() / 1000),
      hasAttachments: false,
      flags: { seen: true, flagged: false, ...flags },
      ...overrides,
    },
  } as StoredItem;
}

type Props = Partial<Parameters<typeof MessageRow>[0]>;

const row = (conversation: Conversation, props: Props = {}) => (
  <MessageRow
    conversation={conversation}
    byRecipient={false}
    self="me@example.org"
    selected={false}
    selecting={false}
    checked={false}
    onOpen={() => {}}
    {...props}
  />
);

beforeEach(() => {
  jest.clearAllMocks();
  useMessageActions.mockReturnValue(actions);
  stopSelecting();
});

describe('message row', () => {
  it('reads sender, subject and preview, and says nothing of state for a plain read message', async () => {
    await renderWithQueries(row(single(item())));

    const label = screen.getByRole('button').props.accessibilityLabel;
    expect(label).toMatch(/^Bob, Quarterly numbers, The report is ready\./);
    expect(label).not.toMatch(/Unread|Flagged|attachments/);
  });

  it('announces unread, flagged and attachments', async () => {
    await renderWithQueries(row(single(item({ hasAttachments: true }, { seen: false, flagged: true }))));

    const label = screen.getByRole('button').props.accessibilityLabel;
    expect(label).toMatch(/^Unread, Bob/);
    expect(label).toContain('Has attachments');
    expect(label).toContain('Flagged');
  });

  it('counts the messages of a conversation and is unread while any of them is', async () => {
    const read = item();
    const unread = { ...item({}, { seen: false }), uid: 2 };
    await renderWithQueries(row({ latest: unread, messages: [read, unread], inView: [read, unread] }));

    expect(screen.getByRole('button').props.accessibilityLabel).toMatch(/^Unread, Bob, 2 messages, /);
  });

  it('lists the recipients instead of the sender in Sent', async () => {
    await renderWithQueries(row(single(item({ to: [{ name: 'Carol', email: 'carol@example.org' }] })), { byRecipient: true }));

    expect(screen.getByRole('button').props.accessibilityLabel).toMatch(/^To Carol, /);
  });

  it('offers the swipe actions to assistive technology, naming the toggles after the current state', async () => {
    await renderWithQueries(row(single(item({}, { seen: false }))));

    const names = screen.getByRole('button').props.accessibilityActions.map((a: { label: string }) => a.label);
    expect(names).toEqual(['Mark as read', 'Flag', 'Archive', 'Delete', 'Move']);
  });

  it('runs the action an assistive technology picks', async () => {
    await renderWithQueries(row(single(item())));
    const target = screen.getByRole('button');

    await fireEvent(target, 'accessibilityAction', { nativeEvent: { actionName: 'toggleFlagged' } });
    await fireEvent(target, 'accessibilityAction', { nativeEvent: { actionName: 'archive' } });

    expect(actions.toggleFlagged).toHaveBeenCalledTimes(1);
    expect(actions.archive).toHaveBeenCalledTimes(1);
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it('opens the message on press', async () => {
    const onOpen = jest.fn();
    const stored = item();
    await renderWithQueries(row(single(stored), { onOpen }));

    await userEvent.setup().press(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledWith(stored);
  });

  it('becomes a checkbox while selecting, and a press checks it instead of opening', async () => {
    const onOpen = jest.fn();
    const conversation = single(item());
    function Selecting() {
      const { keys } = useSelection();
      return row(conversation, { selecting: true, checked: keys.has(conversationKey(conversation)), onOpen });
    }
    await renderWithQueries(<Selecting />);
    const user = userEvent.setup();

    await user.press(screen.getByRole('checkbox', { checked: false }));
    expect(screen.getByRole('checkbox', { checked: true })).toBeOnTheScreen();
    expect(onOpen).not.toHaveBeenCalled();

    await user.press(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox', { checked: false })).toBeOnTheScreen();
    expect(screen.getByRole('checkbox').props.accessibilityActions).toBeUndefined();
  });

  it('offers no archive without an archive action, as in Trash', async () => {
    useMessageActions.mockReturnValue({ ...actions, archive: undefined });
    await renderWithQueries(row(single(item())));

    const names = screen.getByRole('button').props.accessibilityActions.map((a: { label: string }) => a.label);
    expect(names).not.toContain('Archive');
  });
});
