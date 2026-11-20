import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useWebTopInset } from '@/hooks/use-web-sidebar';

export default function CalendarTab() {
  const { t } = useTranslation();
  const topInset = useWebTopInset();
  return (
    <View style={[styles.screen, { paddingTop: topInset }]}>
      <ThemedText type="display" style={styles.title} accessibilityRole="header">
        {t('calendar.comingSoon')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  title: { textAlign: 'center' },
});
