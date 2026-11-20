import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Hairline, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnline } from '@/utils/network';

export function OfflineBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  if (useOnline()) return null;
  return (
    <View style={[styles.banner, { borderBottomColor: theme.border }]} accessibilityLiveRegion="polite">
      <ThemedText type="label">{t('common.offline.title')}</ThemedText>
      <ThemedText type="meta">{t('common.offline.detail')}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
    borderBottomWidth: Hairline,
  },
});
