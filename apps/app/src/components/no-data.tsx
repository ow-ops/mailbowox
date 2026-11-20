import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWebTopInset } from '@/hooks/use-web-sidebar';

type Props = {
  icon: SymbolViewProps['name'];
  title: string;
  syncing: boolean;
  // Set while some account has no server address to sync from yet.
  find?: { text: string; label: string; loading: boolean; onPress: () => void };
  noneText: string;
};

export function NoData({ icon, title, syncing, find, noneText }: Props) {
  const theme = useTheme();
  const topInset = useWebTopInset();
  return (
    <View style={[styles.screen, { paddingTop: topInset }]}>
      <View style={styles.empty}>
        <SymbolView name={icon} size={40} tintColor={theme.primary} />
        <ThemedText type="display" style={styles.center} accessibilityRole="header">
          {title}
        </ThemedText>
        {syncing ? (
          <ActivityIndicator color={theme.muted} />
        ) : (
          <>
            <ThemedText themeColor="muted" style={styles.center}>
              {find ? find.text : noneText}
            </ThemedText>
            {find && <Button label={find.label} loading={find.loading} onPress={find.onPress} />}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  empty: { alignItems: 'center', gap: Spacing.three, maxWidth: 420, alignSelf: 'center' },
  center: { textAlign: 'center' },
});
