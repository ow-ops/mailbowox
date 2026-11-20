import { screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';

import { AddressField, allRecipients, emptyRecipients } from '@/components/address-field';
import { renderWithQueries } from '../jest/render';

jest.mock('@mailbowox/core-native', () => ({}));
jest.mock('@/contacts/queries', () => ({
  useContactAddresses: () => ({ data: [{ name: 'Élodie Marchand', email: 'elodie@example.org' }] }),
}));
jest.mock('@/mail/queries', () => ({ useSeenAddresses: () => ({ data: [{ email: 'elias@example.net' }] }) }));

function Field() {
  const [value, setValue] = useState(emptyRecipients());
  return <AddressField label="To" value={value} onChange={setValue} />;
}

describe('address field', () => {
  it('turns a typed address into a chip when a comma ends it', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Field />);

    await user.type(screen.getByLabelText('To'), 'bob@example.org,');

    expect(screen.getByRole('button', { name: 'Remove bob@example.org' })).toBeOnTheScreen();
    expect(screen.getByLabelText('To')).toHaveDisplayValue('');
  });

  it('marks an invalid address so it can be removed', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Field />);

    await user.type(screen.getByLabelText('To'), 'bob,');

    await user.press(screen.getByRole('button', { name: 'bob is not a valid address. Remove it.' }));
    expect(screen.queryByRole('button', { name: /bob/ })).toBeNull();
  });

  it('suggests contacts first and adds the one that is pressed', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Field />);

    await user.type(screen.getByLabelText('To'), 'el', { skipBlur: true });
    const suggestions = screen.getAllByRole('button', { name: /^Add / });
    expect(suggestions.map((s) => s.props.accessibilityLabel)).toEqual([
      'Add Élodie Marchand, elodie@example.org',
      'Add elias@example.net, elias@example.net',
    ]);

    await user.press(suggestions[0]);
    expect(screen.getByRole('button', { name: 'Remove elodie@example.org' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('removes the last chip on backspace in an empty field', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<Field />);
    await user.type(screen.getByLabelText('To'), 'a@example.org,');

    await user.type(screen.getByLabelText('To'), '{Backspace}');

    expect(screen.queryByRole('button', { name: 'Remove a@example.org' })).toBeNull();
  });
});

describe('allRecipients', () => {
  it('counts what is typed but not yet a chip', () => {
    expect(allRecipients({ list: [{ email: 'a@example.org' }], text: 'b@example.org; c@example.org' })).toEqual([
      { email: 'a@example.org' },
      { email: 'b@example.org' },
      { email: 'c@example.org' },
    ]);
  });
});
