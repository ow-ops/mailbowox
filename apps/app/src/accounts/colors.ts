import type { Account } from './store';

// Indexes into AccountColors. Lavender is the app's accent and rose reads as an error, so new accounts
// take green and amber first.
export const ACCOUNT_HUES = [1, 2, 0, 3];

export const HUE_NAMES = ['lavender', 'green', 'amber', 'rose'] as const;

// Each account keeps the hue it was given; one without picks the least used, earliest in ACCOUNT_HUES.
export function assignColors(emails: string[], chosen: Record<string, number>) {
  const counts = new Map(ACCOUNT_HUES.map((hue) => [hue, 0]));
  const colors: Record<string, number> = {};
  for (const email of emails.map((e) => e.toLowerCase())) {
    const hue =
      chosen[email] ??
      ACCOUNT_HUES.reduce((best, next) => ((counts.get(next) ?? 0) < (counts.get(best) ?? 0) ? next : best));
    colors[email] = hue;
    counts.set(hue, (counts.get(hue) ?? 0) + 1);
  }
  return colors;
}

export const accountLabel = (account: Pick<Account, 'displayName' | 'email'>) =>
  account.displayName || account.email.split('@')[0];
