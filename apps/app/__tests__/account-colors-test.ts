import { accountLabel, assignColors } from '@/accounts/colors';

describe('assignColors', () => {
  it('gives each new account the least used hue, green and amber first', () => {
    expect(assignColors(['a@x', 'b@x', 'c@x', 'd@x', 'e@x'], {})).toEqual({
      'a@x': 1,
      'b@x': 2,
      'c@x': 0,
      'd@x': 3,
      'e@x': 1,
    });
  });

  it('keeps the hues accounts were given, whatever the order', () => {
    expect(assignColors(['B@x', 'a@x', 'c@x'], { 'a@x': 2, 'b@x': 3 })).toEqual({ 'b@x': 3, 'a@x': 2, 'c@x': 1 });
  });

  it('lets two accounts share a hue the user picked for both', () => {
    expect(assignColors(['a@x', 'b@x', 'c@x'], { 'a@x': 1, 'b@x': 1 })).toEqual({ 'a@x': 1, 'b@x': 1, 'c@x': 2 });
  });
});

describe('accountLabel', () => {
  it('is the display name, else the local part of the address', () => {
    expect(accountLabel({ displayName: 'Bob', email: 'bob@mailbowox.test' })).toBe('Bob');
    expect(accountLabel({ displayName: '', email: 'bob@mailbowox.test' })).toBe('bob');
  });
});
