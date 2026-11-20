import type { ErrorEvent } from '@sentry/react-native';

import { scrubBreadcrumb, scrubEvent, scrubText } from '@/crash-reports/scrub';

describe('scrubText', () => {
  it.each([
    ['login failed for erwan@example.com', 'login failed for [email]'],
    ['connect to imap.example.com:993 failed', 'connect to [host] failed'],
    ['refused by 192.168.1.20:143', 'refused by [host]'],
    ['GET https://sync.example.com/vault/ab12 returned 500', 'GET [url] returned 500'],
    ['connect to IMAP.EXAMPLE.COM:993 failed', 'connect to [host] failed'],
    ['no route to Mail.Example.org', 'no route to [host]'],
    ['refused by [2001:db8::25]:587', 'refused by [host]'],
    ['refused by 2001:db8:0:0:0:0:0:25', 'refused by [host]'],
    ['refused by fe80::1 on the LAN', 'refused by [host] on the LAN'],
    ['refused by ::1', 'refused by [host]'],
  ])('replaces what identifies an account in %s', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    "undefined is not a function (evaluating 'core.verifyAccount')",
    'panicked at std::io::Error',
    'timed out at 12:30:45',
  ])('leaves %s readable', (message) => {
    expect(scrubText(message)).toBe(message);
  });
});

describe('scrubEvent', () => {
  const event = {
    type: undefined,
    message: 'No mailbox for me@example.com',
    user: { ip_address: '{{auto}}' },
    server_name: 'my-laptop',
    request: { url: 'https://app.example.com/message?uid=4' },
    extra: { subject: 'Lunch?' },
    transaction: '/mailbox/imap.example.com',
    tags: { mailbox: 'me@example.com' },
    contexts: {
      app: { app_version: '1.2.0' },
      os: { name: 'iOS', version: '26.1' },
      device: { name: "Erwan's iPhone", model: 'iPhone17,1' },
      route: { params: { account: 'me@example.com' } },
    },
    exception: { values: [{ type: 'Error at imap.example.com', value: 'tls error talking to mail.example.com:993' }] },
  } as ErrorEvent;

  it('drops the user, request and extra data', () => {
    expect(scrubEvent(event)).not.toHaveProperty('user');
    expect(scrubEvent(event)).not.toHaveProperty('request');
    expect(scrubEvent(event)).not.toHaveProperty('server_name');
    expect(scrubEvent(event)).not.toHaveProperty('extra');
    expect(scrubEvent(event)).not.toHaveProperty('tags');
  });

  it('keeps only the app, system and device contexts, without the device name', () => {
    expect(scrubEvent(event).contexts).toEqual({
      app: { app_version: '1.2.0' },
      os: { name: 'iOS', version: '26.1' },
      device: { model: 'iPhone17,1' },
    });
  });

  it('scrubs the message, transaction and exception text', () => {
    const scrubbed = scrubEvent(event);
    expect(scrubbed.message).toBe('No mailbox for [email]');
    expect(scrubbed.exception?.values?.[0].value).toBe('tls error talking to [host]');
    expect(scrubbed.exception?.values?.[0].type).toBe('Error at [host]');
    expect(scrubbed.transaction).toBe('/mailbox/[host]');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console output', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'password is pw' })).toBeNull();
  });

  it('keeps the category but not the data', () => {
    const kept = scrubBreadcrumb({ category: 'fetch', data: { url: 'https://sync.example.com' }, level: 'info' });
    expect(kept).toEqual({ category: 'fetch', level: 'info', message: undefined });
  });
});
