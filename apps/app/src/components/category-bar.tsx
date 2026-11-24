import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Press, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_CHOICES, chooseCategory, useCategoryChoice, type CategoryChoice } from '@/mail/filters';

const ICONS = {
  primary: { ios: 'person', android: 'person', web: 'person' },
  transactions: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  updates: { ios: 'newspaper', android: 'newspaper', web: 'newspaper' },
  promotions: { ios: 'megaphone', android: 'campaign', web: 'campaign' },
  all: { ios: 'tray.full', android: 'inbox', web: 'inbox' },
} as const;

const SIZE = 36;

// Five names don't fit across a phone, so only the chosen one shows its name; the others are their icon.
export function CategoryBar() {
  const { t } = useTranslation();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const choice = useCategoryChoice();

  const choose = (value: CategoryChoice) => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeOut', 'opacity'));
    chooseCategory(value);
  };

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('mail.categories.label')}>
      {CATEGORY_CHOICES.map((value) => {
        const chosen = choice === value;
        const name = t(`mail.categories.${value}`);
        return (
          <Pressable
            key={value}
            onPress={() => choose(value)}
            accessibilityRole="radio"
            accessibilityLabel={name}
            accessibilityState={{ checked: chosen }}
            hitSlop={Spacing.one}
            style={({ pressed }) => [
              styles.item,
              chosen && { backgroundColor: theme.accentSoft, paddingHorizontal: Spacing.oneHalf },
              pressed && { opacity: Press.opacity },
            ]}>
            <SymbolView name={ICONS[value]} size={20} tintColor={chosen ? theme.onAccentSoft : theme.muted} />
            {chosen && (
              <ThemedText type="labelSmall" numberOfLines={1} style={{ color: theme.onAccentSoft }}>
                {name}
              </ThemedText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  item: {
    height: SIZE,
    minWidth: SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: SIZE / 2,
    borderCurve: 'continuous',
  },
});
