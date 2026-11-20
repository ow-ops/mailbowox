import { AccountColors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';
import { getPrefs, setPref, usePref } from '@/prefs/store';

import { assignColors } from './colors';
import { getAccounts, useAccounts, type Account } from './store';

export function useAccountHues() {
  const accounts = useAccounts();
  const chosen = usePref('accountColors');
  return assignColors(accounts.map((a) => a.email), chosen);
}

export function useAccountColor(account: Account) {
  const hue = useAccountHues()[account.email.toLowerCase()];
  return AccountColors[useScheme()][hue];
}

export const setAccountColor = (email: string, hue: number) =>
  setPref('accountColors', { ...getPrefs().accountColors, [email.toLowerCase()]: hue });

// Stores the hue a new account was given, so removing an account never recolours the others.
export function pinAccountColor(email: string) {
  const { accountColors } = getPrefs();
  if (accountColors[email.toLowerCase()] !== undefined) return;
  const hue = assignColors(
    getAccounts().map((a) => a.email),
    accountColors,
  )[email.toLowerCase()];
  setAccountColor(email, hue);
}
