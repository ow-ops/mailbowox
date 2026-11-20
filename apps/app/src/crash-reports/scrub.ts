import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

const EMAIL = /[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}/gi;
const URL = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
// Bracketed, full, or shortened with "::". A bare address needs one of the last two shapes, so times such as
// 12:30:45 and paths such as std::io are left alone.
const IPV6 =
  /\[[0-9a-f.]*:[0-9a-f:.]*\](?::\d+)?|(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?)(?![\w:])/gi;
// The last label is all lowercase or all uppercase, so property paths such as core.verifyAccount in a TypeError
// stay readable while IMAP.EXAMPLE.COM is caught.
const HOST = /\b(?:[A-Za-z0-9-]+\.)+(?:[a-z]{2,}|[A-Z]{2,})\b(?::\d+)?/g;

export const scrubText = (text: string) =>
  text
    .replace(EMAIL, '[email]')
    .replace(URL, '[url]')
    .replace(IPV4, '[host]')
    .replace(IPV6, '[host]')
    .replace(HOST, '[host]');

// Mail core errors can quote server replies and addresses, so every message is scrubbed and anything else
// identifying an account or place is dropped. Of the contexts, only app, system and device descriptions
// stay, minus the device name.
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { user, request, server_name, extra, tags, contexts, ...rest } = event;
  const { name: _name, ...device } = contexts?.device ?? {};
  return {
    ...rest,
    message: event.message && scrubText(event.message),
    transaction: event.transaction && scrubText(event.transaction),
    contexts: { app: contexts?.app, os: contexts?.os, device },
    exception: event.exception && {
      values: event.exception.values?.map((e) => ({
        ...e,
        type: e.type && scrubText(e.type),
        value: e.value && scrubText(e.value),
      })),
    },
  };
}

// Breadcrumbs keep what happened (category, level, time) but not what it was about: URLs, route
// parameters and console output can all carry account data.
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const { data, ...rest } = breadcrumb;
  return { ...rest, message: breadcrumb.message && scrubText(breadcrumb.message) };
}
