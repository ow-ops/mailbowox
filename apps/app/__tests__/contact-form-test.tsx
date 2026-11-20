import { screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ContactFormScreen } from '@/components/contact-form';
import { renderWithQueries } from '../jest/render';

jest.mock('@mailbowox/core-native', () => ({}));
jest.mock('expo-router', () => require('../jest/expo-router'));
jest.mock('@/contacts/actions', () => ({ useSaveContact: jest.fn() }));
jest.mock('@/contacts/queries', () => ({ useAddressBooks: jest.fn() }));
// The native picker exposes nothing to query; the web one offers the same choice as radio buttons.
jest.mock('@/components/menu-picker', () => ({
  MenuPicker: jest.requireActual('../src/components/segmented-control.tsx').SegmentedControl,
}));

const { router } = require('expo-router');
const { useSaveContact } = require('@/contacts/actions');
const { useAddressBooks } = require('@/contacts/queries');

const personal = { account: 'a', href: '/personal/', name: 'Personal', readOnly: false };
const shared = { account: 'a', href: '/shared/', name: 'Shared', readOnly: false };
const archive = { account: 'a', href: '/archive/', name: 'Archive', readOnly: true };

const mutate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useSaveContact.mockReturnValue({ mutate, reset: jest.fn(), isPending: false, isError: false });
  useAddressBooks.mockReturnValue({ data: [personal] });
});

describe('contact form', () => {
  it('cannot be saved until it has a name', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<ContactFormScreen />);
    const save = () => screen.getByRole('button', { name: 'Save' });

    expect(save()).toBeDisabled();
    await user.type(screen.getByLabelText('First name'), 'Ada');
    expect(save()).toBeEnabled();

    await user.press(save());
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'a', book: '/personal/', draft: expect.objectContaining({ name: 'Ada' }) }),
      expect.anything(),
    );
  });

  it('says what is missing once the name is cleared again', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<ContactFormScreen />);
    await user.type(screen.getByLabelText('First name'), 'A');
    await user.clear(screen.getByLabelText('First name'));

    expect(screen.getByText('Enter a name, a company or an email address.')).toBeOnTheScreen();
  });

  it('adds and removes email fields, and cycles the label on request', async () => {
    const user = userEvent.setup();
    await renderWithQueries(<ContactFormScreen />);
    await user.press(screen.getByRole('button', { name: 'Add an email address' }));
    await user.type(screen.getByLabelText('Email address'), 'ada@example.org');

    const kind = screen.getByRole('button', { name: /^Label: / });
    const before = kind.props.accessibilityLabel;
    await user.press(kind);
    expect(screen.getByRole('button', { name: /^Label: / }).props.accessibilityLabel).not.toBe(before);

    await user.press(screen.getByRole('button', { name: 'Remove ada@example.org' }));
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });

  it('offers a choice of address book only when more than one is writable', async () => {
    useAddressBooks.mockReturnValue({ data: [personal, shared, archive] });
    const user = userEvent.setup();
    await renderWithQueries(<ContactFormScreen />);

    expect(screen.getByRole('radio', { name: 'Personal', checked: true })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Archive' })).toBeNull();

    await user.press(screen.getByRole('radio', { name: 'Shared' }));
    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ book: '/shared/' }), expect.anything());
  });

  it('leaves at once when nothing was typed, and asks before discarding edits', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    await renderWithQueries(<ContactFormScreen />);

    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.back).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(alert).toHaveBeenCalledWith('Discard this contact?', undefined, expect.any(Array));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
