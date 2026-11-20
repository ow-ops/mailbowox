import type { TFunction } from 'i18next';

import type { Address } from '@/core';
import type { Prefs } from '@/prefs/store';

import { addressName } from './address';

export function remoteNotice(t: TFunction, count: number, sender: Address | undefined, pref: Prefs['remoteContent']) {
  if (pref === 'never') return t('mail.reader.remoteNever', { count });
  const name = sender ? addressName(sender) : t('mail.reader.theSender');
  return t('mail.reader.remoteBlocked', { count, name });
}
