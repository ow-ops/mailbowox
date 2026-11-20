import type { TlsFailure } from './types';
import { t } from '@/i18n';

// UniFFI errors carry the name of their CoreError variant in `tag`.
const tagOf = (error: unknown) => (error as { tag?: unknown } | null)?.tag;

// Why TLS failed, on the core's `Tls` errors.
const reasonOf = (error: unknown) => (error as { reason?: TlsFailure } | null)?.reason;

const messageOf = (error: unknown) => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
};

export function coreErrorKind(error: unknown): 'auth' | 'unreachable' | 'tls' | 'other' {
  const tag = tagOf(error);
  if (tag === 'Auth') return 'auth';
  if (tag === 'Network') return 'unreachable';
  if (tag === 'Tls') return 'tls';
  return 'other';
}

// The server may have accepted the message before the connection failed, so sending it again could deliver it twice.
export const isUnconfirmed = (error: unknown) => tagOf(error) === 'Unconfirmed';

// A missing message or a rejected argument leaves the IMAP connection usable; anything else may not.
export const keepsConnection = (error: unknown) => tagOf(error) === 'NotFound' || tagOf(error) === 'Invalid';

type ErrorKind =
  | 'auth'
  | 'plainPort'
  | 'noStartTls'
  | 'certificate'
  | 'tls'
  | 'relay'
  | 'unreachable'
  | 'server'
  | 'device';

const TLS_KINDS: Record<TlsFailure, ErrorKind> = {
  notTls: 'plainPort',
  startTlsRefused: 'noStartTls',
  certificate: 'certificate',
  other: 'tls',
};

// The core reports failures by variant, and for TLS the reason, which tells the common misconfigurations apart.
export function errorKind(error: unknown): ErrorKind {
  switch (tagOf(error)) {
    case 'Auth':
      return 'auth';
    case 'Tls':
      return TLS_KINDS[reasonOf(error) ?? 'other'];
    case 'Network':
      return messageOf(error).includes('web relay') ? 'relay' : 'unreachable';
    case undefined:
      // Only the core tags its errors: anything else failed in the app, mostly reading or writing its database.
      return 'device';
    default:
      return 'server';
  }
}

export type Explanation = { summary: string; detail: string };

// A sentence for the user in their language, with the raw text kept as the detail.
export const explainError = (error: unknown): Explanation => ({
  summary: t(`common.errors.${errorKind(error)}`),
  detail: messageOf(error),
});

export function explainSendError(error: unknown): Explanation {
  const tag = tagOf(error);
  if (tag === 'Invalid') return { summary: t('mail.outbox.errors.invalid'), detail: messageOf(error) };
  if (tag === 'Unconfirmed') return { summary: t('mail.outbox.errors.unconfirmed'), detail: messageOf(error) };
  if (tag === 'Protocol' || tag === 'NotFound') return { summary: t('mail.outbox.errors.refused'), detail: messageOf(error) };
  return explainError(error);
}

// The outbox keeps a send failure across restarts as the core's variant and text, so it is explained in the
// language of the moment it is shown.
export const storeError = (error: unknown) =>
  JSON.stringify({ tag: tagOf(error), reason: reasonOf(error), message: messageOf(error) });

export function restoreError(stored: string): unknown {
  return JSON.parse(stored);
}
