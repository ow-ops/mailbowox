import { displayName, embeddedPhoto, initials, letterOf } from '@/contacts/format';

describe('contact format', () => {
  it('takes initials from the first and last word', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('élodie  de la Marchand')).toBe('ÉM');
    expect(initials('Cher')).toBe('C');
    expect(initials('')).toBe('');
  });

  it('files names under a letter, and anything else under #', () => {
    expect(letterOf('lovelace ada')).toBe('L');
    expect(letterOf('1password')).toBe('#');
  });

  it('shows the name, else the first address', () => {
    expect(displayName({ name: 'Ada', emails: [{ value: 'a@x.test' }] })).toBe('Ada');
    expect(displayName({ name: '', emails: [{ value: 'a@x.test' }] })).toBe('a@x.test');
  });

  it('shows only photos that travel with the card', () => {
    expect(embeddedPhoto('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(embeddedPhoto('https://tracker.example/me.jpg')).toBeUndefined();
    expect(embeddedPhoto(undefined)).toBeUndefined();
  });
});
