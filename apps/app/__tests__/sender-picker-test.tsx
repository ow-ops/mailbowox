import { screen, userEvent } from '@testing-library/react-native';

import { SenderPicker } from '@/components/sender-picker';
import type { Sender } from '@/mail/from';
import { renderWithQueries } from '../jest/render';

jest.mock('expo-router', () => require('../jest/expo-router'));

jest.mock('@mailbowox/core-native', () => ({}));

const personal: Sender = { account: 'a', address: { email: 'me@example.org' } };
const alias: Sender = { account: 'a', address: { name: 'Shop', email: 'shop@example.org' } };
const work: Sender = { account: 'b', address: { email: 'me@work.example' } };

describe('sender picker', () => {
  it('shows the picked address collapsed, and lists every sender once opened', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<SenderPicker senders={[personal, alias, work]} value={alias} onChange={() => {}} />);

    const line = screen.getByRole('button', { name: 'From shop@example.org', expanded: false });
    expect(screen.queryByRole('radio')).toBeNull();

    await user.press(line);

    expect(screen.getByRole('button', { name: 'From shop@example.org', expanded: true })).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'shop@example.org, Shop', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'me@work.example', checked: false })).toBeOnTheScreen();
  });

  it('reports the choice and collapses again', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await renderWithQueries(<SenderPicker senders={[personal, work]} value={personal} onChange={onChange} />);

    await user.press(screen.getByRole('button', { name: 'From me@example.org' }));
    await user.press(screen.getByRole('radio', { name: 'me@work.example' }));

    expect(onChange).toHaveBeenCalledWith(work);
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
