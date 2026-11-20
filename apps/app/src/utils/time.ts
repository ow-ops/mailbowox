import { differenceInCalendarDays, format, isSameDay, isSameYear } from 'date-fns';

import { dateLocale, t } from '@/i18n';

export function listTime(seconds: number, now = new Date()) {
  const date = new Date(seconds * 1000);
  const locale = dateLocale();
  if (isSameDay(date, now)) return format(date, 'p', { locale });
  if (differenceInCalendarDays(now, date) < 7) return format(date, 'EEE', { locale });
  return format(date, isSameYear(date, now) ? t('common.time.dayMonth') : 'P', { locale });
}


export const fullTime = (seconds: number) => format(new Date(seconds * 1000), 'PPPp', { locale: dateLocale() });
