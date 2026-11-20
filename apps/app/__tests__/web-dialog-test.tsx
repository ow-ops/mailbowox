import { act, render, screen, userEvent } from '@testing-library/react-native';

import { WebDialog } from '@/components/web-dialog';
import { useWebDialog } from '@/utils/dialog';

it('names each action and runs the one picked', async () => {
  const discard = jest.fn();
  const user = userEvent.setup();
  await render(<WebDialog />);

  await act(() =>
    useWebDialog.setState({
      open: {
        title: 'Save this message as a draft?',
        choices: [
          { label: 'Keep editing', style: 'cancel' },
          { label: 'Discard', style: 'destructive', onPress: discard },
        ],
      },
    }),
  );
  expect(screen.getByText('Save this message as a draft?')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Discard' }));

  expect(discard).toHaveBeenCalled();
  expect(screen.queryByText('Save this message as a draft?')).toBeNull();
});
