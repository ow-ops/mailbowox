import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorExplanation } from '@/components/error-explanation';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { explainError } from '@/core/errors';

type Props = {
  pending: boolean;
  error: Error | null;
  emptyText?: string;
  onRetry?: () => void;
};

export function QueryState({ pending, error, emptyText, onRetry }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (pending) return <ActivityIndicator color={theme.muted} />;
  if (error) {
    return (
      <View style={styles.error} accessibilityLiveRegion="polite">
        <ErrorExplanation {...explainError(error)} centered />
        {onRetry && <Button label={t('common.retry')} variant="outline" size="small" onPress={onRetry} />}
      </View>
    );
  }
  return emptyText ? (
    <ThemedText type="name" themeColor="muted">
      {emptyText}
    </ThemedText>
  ) : null;
}

const styles = StyleSheet.create({
  error: {
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
  },
});
