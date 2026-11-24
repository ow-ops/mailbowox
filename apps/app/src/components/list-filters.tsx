import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { Button } from '@/components/button';
import { Spacing } from '@/constants/theme';
import { FILTER_KEYS, toggleAccount, toggleFilter, useFilters, useHiddenAccounts } from '@/mail/filters';
import type { MailView } from '@/mail/view';

export function ListFilters({ view }: { view: MailView }) {
  const { t } = useTranslation();
  const on = useFilters();
  const accounts = useAccounts();
  const hidden = useHiddenAccounts();
  const shown = accounts.filter((account) => !hidden.includes(account.id));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('mail.filters.label')}
      contentContainerStyle={styles.row}>
      {FILTER_KEYS.map((key) => (
        <Button
          key={key}
          label={t(`mail.filters.${key}`)}
          variant="outline"
          size="small"
          selected={on[key]}
          onPress={() => toggleFilter(key)}
        />
      ))}
      {view.kind !== 'mailbox' &&
        accounts.length > 1 &&
        accounts.map((account) => (
          <Button
            key={account.id}
            label={t('mail.filters.without', { name: account.displayName || account.email })}
            variant="outline"
            size="small"
            selected={hidden.includes(account.id)}
            disabled={shown.length === 1 && shown[0].id === account.id}
            onPress={() => toggleAccount(account.id)}
          />
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
