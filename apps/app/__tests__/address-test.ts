import { formatAddress, isEmail, parseAddress, parseAddresses } from '@/mail/address';

describe('parseAddresses', () => {
  it('reads bare addresses separated by commas, semicolons and newlines', () => {
    expect(parseAddresses('a@example.com, b@example.com;c@example.com\nd@example.com')).toEqual([
      { email: 'a@example.com' },
      { email: 'b@example.com' },
      { email: 'c@example.com' },
      { email: 'd@example.com' },
    ]);
  });

  it('keeps a quoted name with a comma in one address', () => {
    expect(parseAddresses('"Martin, Claire" <claire@example.com>, Paul <paul@example.com>')).toEqual([
      { name: 'Martin, Claire', email: 'claire@example.com' },
      { name: 'Paul', email: 'paul@example.com' },
    ]);
  });

  it('drops empty entries', () => {
    expect(parseAddresses(' , a@example.com ,, ')).toEqual([{ email: 'a@example.com' }]);
  });

  it('reads an address in brackets without a name', () => {
    expect(parseAddress('<a@example.com>')).toEqual({ email: 'a@example.com' });
  });
});

describe('formatAddress', () => {
  it('quotes names that would not survive a round trip', () => {
    const claire = { name: 'Martin, Claire', email: 'claire@example.com' };
    expect(formatAddress(claire)).toBe('"Martin, Claire" <claire@example.com>');
    expect(parseAddresses(formatAddress(claire))).toEqual([claire]);
  });

  it('leaves plain names and bare addresses alone', () => {
    expect(formatAddress({ name: 'Paul', email: 'paul@example.com' })).toBe('Paul <paul@example.com>');
    expect(formatAddress({ email: 'paul@example.com' })).toBe('paul@example.com');
  });
});

describe('isEmail', () => {
  it('accepts local test domains and rejects fragments', () => {
    expect(isEmail('user@localhost')).toBe(true);
    expect(isEmail('user@example.com')).toBe(true);
    expect(isEmail('user')).toBe(false);
    expect(isEmail('user@')).toBe(false);
    expect(isEmail('a b@example.com')).toBe(false);
  });
});
