import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { accountLabel } from '@/accounts/colors';
import { useAccounts } from '@/accounts/store';
import { CategoryBar } from '@/components/category-bar';
import { NativeMenu } from '@/components/native-menu';
import { ThemedText } from '@/components/themed-text';
import { Press, Spacing } from '@/constants/theme';
import {
  clearFilters,
  FILTER_KEYS,
  toggleAccount,
  toggleFilter,
  useFilters,
  useHiddenAccounts,
} from '@/mail/filters';
import type { MailView } from '@/mail/view';

const FILTER_ICON = {
  ios: 'line.3.horizontal.decrease.circle',
  android: 'filter_list',
  web: 'filter_list',
} as const;

// One line: the inbox categories, then a menu of what narrows the list. What is on shows underneath.
export function ListFilters({ view, categories }: { view: MailView; categories: boolean }) {
  const { t } = useTranslation();
  const on = useFilters();
  const accounts = useAccounts();
  const hidden = useHiddenAccounts();
  const across = view.kind !== 'mailbox' && accounts.length > 1;
  const shown = accounts.filter((account) => !hidden.includes(account.id));

  const active = [
    ...FILTER_KEYS.filter((key) => on[key]).map((key) => t(`mail.filters.${key}`)),
    ...(across ? accounts.filter((a) => hidden.includes(a.id)).map((a) => t('mail.filters.without', { name: accountLabel(a) })) : []),
  ];

  const menu = (
    <NativeMenu
      label={t('mail.filters.button')}
      icon={FILTER_ICON}
      active={active.length > 0}
      groups={[
        FILTER_KEYS.map((key) => ({
          key,
          title: t(`mail.filters.${key}`),
          checked: on[key],
          onPress: () => toggleFilter(key),
        })),
        ...(across
          ? [
              accounts.map((account) => ({
                key: account.id,
                title: accountLabel(account),
                checked: !hidden.includes(account.id),
                // The last account shown stays: a list of nothing is no filter.
                disabled: shown.length === 1 && !hidden.includes(account.id),
                onPress: () => toggleAccount(account.id),
              })),
            ]
          : []),
      ]}
    />
  );

  const summary = active.length > 0 && (
    <View style={styles.summary}>
      <ThemedText type="meta" numberOfLines={1} style={styles.grow}>
        {active.join(', ')}
      </ThemedText>
      <Pressable
        onPress={clearFilters}
        accessibilityRole="button"
        hitSlop={Spacing.oneHalf}
        style={({ pressed }) => pressed && { opacity: Press.opacity }}>
        <ThemedText type="labelSmall" themeColor="primary">
          {t('mail.filters.clear')}
        </ThemedText>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        {categories ? <CategoryBar /> : <View style={styles.grow}>{summary}</View>}
        {menu}
      </View>
      {categories && summary}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingRight: Spacing.two,
  },
  grow: { flex: 1 },
});
