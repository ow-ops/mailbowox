import { render, screen, userEvent } from '@testing-library/react-native';

import { Button } from '@/components/button';

// The radio-button version; iOS and Android draw a native control instead.
const { SegmentedControl }: typeof import('@/components/segmented-control') = jest.requireActual(
  '../src/components/segmented-control.tsx',
);

describe('Button', () => {
  it('stays named and reports itself busy while loading', async () => {
    await render(<Button label="Sign in" loading onPress={() => {}} />);

    expect(screen.getByRole('button', { name: 'Sign in', busy: true, disabled: true })).toBeOnTheScreen();
  });

  it('does not press while disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" disabled onPress={onPress} />);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Save' }));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('prefers an explicit accessibility label over its text', async () => {
    await render(<Button label="Go" accessibilityLabel="Go to inbox" onPress={() => {}} />);

    expect(screen.getByRole('button', { name: 'Go to inbox' })).toBeOnTheScreen();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
  ];

  it('exposes the options as a radio group with the current one checked', async () => {
    await render(<SegmentedControl label="View" options={options} value="week" onChange={() => {}} />);

    expect(screen.getByRole('radio', { name: 'Week', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Day', checked: false })).toBeOnTheScreen();
  });

  it('reports the option that is pressed', async () => {
    const onChange = jest.fn();
    await render(<SegmentedControl label="View" options={options} value="week" onChange={onChange} />);

    await userEvent.setup().press(screen.getByRole('radio', { name: 'Day' }));

    expect(onChange).toHaveBeenCalledWith('day');
  });
});
