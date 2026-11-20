import { StyleSheet, View } from 'react-native';

import { accountLabel } from '@/accounts/colors';
import type { Account } from '@/accounts/store';
import { useAccountColor } from '@/accounts/use-account-color';
import { ThemedText } from '@/components/themed-text';
import { AccountColors, Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';

export function AccountDot({ account }: { account: Account }) {
  return <View style={[styles.dot, { backgroundColor: useAccountColor(account) }]} />;
}

export function AccountSwatch({ hue }: { hue: number }) {
  return <View style={[styles.swatch, { backgroundColor: AccountColors[useScheme()][hue] }]} />;
}

// Which account a message belongs to, where a list or reader mixes accounts. Rows read it out in their own label.
export function AccountMark({ account }: { account: Account }) {
  return (
    <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <AccountDot account={account} />
      <ThemedText type="meta" numberOfLines={1} style={styles.label}>
        {accountLabel(account)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Square, so it never reads as the round unread dot.
  dot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    flexShrink: 1,
  },
  label: {
    flexShrink: 1,
    maxWidth: 120,
  },
});
