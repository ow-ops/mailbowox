import { useMutation } from '@tanstack/react-query';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { ErrorExplanation } from '@/components/error-explanation';
import { ThemedText } from '@/components/themed-text';
import { Hairline, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { explainError } from '@/core/errors';
import { handlesError } from '@/utils/query-client';
import { showError } from '@/utils/toast';

export function useSyncRefresh(sync: () => Promise<void>, failedTitle: string) {
  const theme = useTheme();
  const refresh = useMutation({
    mutationFn: sync,
    meta: handlesError,
    onError: (error) => showError(failedTitle, explainError(error).summary),
  });

  return (
    <RefreshControl
      refreshing={refresh.isPending}
      onRefresh={() => refresh.mutate()}
      tintColor={theme.muted}
      colors={[theme.primary]}
      progressBackgroundColor={theme.surface}
    />
  );
}

export function SyncFailureBanners({ errors, title }: { errors: Record<string, unknown>; title: (email: string) => string }) {
  const theme = useTheme();
  const accounts = useAccounts().filter((account) => errors[account.id]);
  return accounts.map((account) => (
    <View
      key={account.id}
      style={[styles.banner, { borderBottomColor: theme.border }]}
      accessibilityLiveRegion="polite">
      <ThemedText type="label" themeColor="danger">
        {title(account.email)}
      </ThemedText>
      <ErrorExplanation {...explainError(errors[account.id])} />
    </View>
  ));
}

const styles = StyleSheet.create({
  banner: {
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
    borderBottomWidth: Hairline,
  },
});
