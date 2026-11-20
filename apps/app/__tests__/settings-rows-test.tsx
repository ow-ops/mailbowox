import { screen, userEvent } from '@testing-library/react-native';

import { Row, ToggleRow } from '@/components/settings';
import { renderWithQueries } from '../jest/render';

jest.mock('expo-router', () => require('../jest/expo-router'));

describe('ToggleRow', () => {
  it('is a switch named by its title and detail, and toggles from anywhere on the row', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderWithQueries(<ToggleRow title="Group by conversation" detail="Messages in a thread share a row" value={false} onValueChange={onValueChange} />);

    await user.press(screen.getByRole('switch', { name: /Group by conversation/, checked: false }));

    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('reports the opposite of its current value', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderWithQueries(<ToggleRow title="Notifications" value onValueChange={onValueChange} />);

    await user.press(screen.getByRole('switch', { name: 'Notifications', checked: true }));

    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('ignores presses while disabled', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderWithQueries(<ToggleRow title="Notifications" value={false} disabled onValueChange={onValueChange} />);

    await user.press(screen.getByRole('switch', { name: 'Notifications', disabled: true }));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('Row', () => {
  it('is a button only when it can be pressed', async () => {
    await renderWithQueries(
      <>
        <Row title="Server" detail="mail.example.org" />
        <Row title="Sync now" onPress={() => {}} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Sync now' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Server/ })).toBeNull();
  });

  it('is a radio when it is one of a choice, checked when selected', async () => {
    await renderWithQueries(
      <>
        <Row title="Light" selected={false} onPress={() => {}} />
        <Row title="Dark" selected onPress={() => {}} />
      </>,
    );

    expect(screen.getByRole('radio', { name: 'Dark', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Light', checked: false })).toBeOnTheScreen();
  });

  it('reads as busy and does not press while loading', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithQueries(<Row title="Sync now" detail="Syncing" loading onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Sync now, Syncing', busy: true }));

    expect(onPress).not.toHaveBeenCalled();
  });
});
