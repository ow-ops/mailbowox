import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { ThemedText } from '@/components/themed-text';
import { Press, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  CATEGORY_CHOICES,
  chooseCategory,
  shownBoxes,
  useCategoryChoice,
  useHiddenAccounts,
} from '@/mail/filters';
import { useCategoryUnread } from '@/mail/queries';
import type { MailView } from '@/mail/view';

const ICONS = {
  primary: { ios: 'person', android: 'person', web: 'person' },
  transactions: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  updates: { ios: 'newspaper', android: 'newspaper', web: 'newspaper' },
  promotions: { ios: 'megaphone', android: 'campaign', web: 'campaign' },
  all: { ios: 'tray.full', android: 'inbox', web: 'inbox' },
} as const;

const SIZE = 36;

// Five names don't fit across a phone, so only the chosen one shows its name; the others are their icon.
export function CategoryBar({ view }: { view: MailView }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const choice = useCategoryChoice();
  const unread = useCategoryUnread(shownBoxes(view, useAccounts(), useHiddenAccounts()));

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('mail.categories.label')}>
      {CATEGORY_CHOICES.map((value) => {
        const chosen = choice === value;
        const name = t(`mail.categories.${value}`);
        const count = unread.get(value) ?? 0;
        const tint = chosen ? theme.onAccentSoft : theme.muted;
        return (
          <Pressable
            key={value}
            onPress={() => chooseCategory(value)}
            accessibilityRole="radio"
            accessibilityLabel={count > 0 ? t('mail.categories.unread', { name, count }) : name}
            accessibilityState={{ checked: chosen }}
            hitSlop={Spacing.one}
            style={({ pressed }) => [
              styles.item,
              (chosen || count > 0) && { paddingHorizontal: Spacing.oneHalf },
              chosen && { backgroundColor: theme.accentSoft },
              pressed && { opacity: Press.opacity },
            ]}>
            <SymbolView name={ICONS[value]} size={20} tintColor={tint} />
            {chosen && (
              <ThemedText type="labelSmall" numberOfLines={1} style={{ color: tint }}>
                {name}
              </ThemedText>
            )}
            {count > 0 && (
              <ThemedText type="labelSmall" style={{ color: tint, fontVariant: ['tabular-nums'] }}>
                {count > 99 ? '99+' : count}
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
