import { resign, sign } from '@/mail/reply';

const quoted = '\n\nOn Monday, Bob wrote:\n> Hi';

describe('sign', () => {
  it('ends a new message with the signature, after the usual delimiter', () => {
    expect(sign('', 'Alice\nAcme')).toBe('\n\n-- \nAlice\nAcme');
  });

  it('puts the signature above the quoted text of a reply', () => {
    expect(sign(quoted, 'Alice')).toBe(`\n\n-- \nAlice${quoted}`);
  });

  it('adds nothing for an account without a signature', () => {
    expect(sign(quoted)).toBe(quoted);
  });
});

describe('resign', () => {
  it('swaps the signature for the new account\'s, keeping what was typed', () => {
    expect(resign(`Sure.${sign(quoted, 'Alice')}`, quoted, 'Alice', 'A. Martin')).toBe(`Sure.${sign(quoted, 'A. Martin')}`);
  });

  it('drops the signature when the new account has none', () => {
    expect(resign(`Sure.${sign('', 'Alice')}`, '', 'Alice')).toBe('Sure.');
  });

  it('adds one above the quoted text when the first account had none', () => {
    expect(resign(`Sure.${quoted}`, quoted, undefined, 'Alice')).toBe(`Sure.${sign(quoted, 'Alice')}`);
  });

  it('leaves a signature the user has edited', () => {
    const edited = 'Sure.\n\n-- \nAlice (on holiday)';
    expect(resign(edited, '', 'Alice', 'A. Martin')).toBe(edited);
  });
});
