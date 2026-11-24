import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Spacing } from '@/constants/theme';
import { FILTER_KEYS, toggleFilter, useFilters } from '@/mail/filters';

export function ListFilters() {
  const { t } = useTranslation();
  const on = useFilters();
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
