import { gravatarUrl, organizationDomain } from '@/contacts/avatars';

jest.mock('@/mail/store', () => ({ mailStore: jest.fn() }));

describe('organizationDomain', () => {
  it('keeps the registered domain of a sending host', () => {
    expect(organizationDomain('mail.news.example.com')).toBe('example.com');
    expect(organizationDomain('email.shop.example.co.uk')).toBe('example.co.uk');
    expect(organizationDomain('example.org')).toBe('example.org');
  });
});

describe('gravatarUrl', () => {
  it('hashes the trimmed, lowercased address and asks for a 404 rather than a placeholder', () => {
    expect(gravatarUrl(' Alice@Example.com ')).toBe(gravatarUrl('alice@example.com'));
    expect(gravatarUrl('alice@example.com')).toMatch(/^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{64}\?s=128&d=404$/);
  });
});
