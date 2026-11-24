import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Spacing } from '@/constants/theme';
import { CATEGORY_CHOICES, chooseCategory, useCategoryChoice } from '@/mail/filters';

export function CategoryBar() {
  const { t } = useTranslation();
  const choice = useCategoryChoice();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('mail.categories.label')}
      contentContainerStyle={styles.row}>
      {CATEGORY_CHOICES.map((value) => (
        <Button
          key={value}
          label={t(`mail.categories.${value}`)}
          variant="outline"
          size="small"
          role="radio"
          selected={choice === value}
          onPress={() => chooseCategory(value)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
});
