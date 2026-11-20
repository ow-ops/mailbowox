import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  saveLabel: string;
  canSave: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
};

export function FormHeader({ title, saveLabel, canSave, saving, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Stack.Screen
      options={{
        title,
        headerLeft: () => (
          <Pressable
            onPress={onCancel}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            style={styles.button}>
            {Platform.OS === 'android' ? (
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={24} tintColor={theme.heading} />
            ) : (
              <ThemedText type="label" themeColor="primary">
                {t('common.cancel')}
              </ThemedText>
            )}
          </Pressable>
        ),
        headerRight: () =>
          saving ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <Pressable
              onPress={onSave}
              disabled={!canSave}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              style={styles.button}>
              <ThemedText type="label" themeColor={canSave ? 'primary' : 'muted'}>
                {saveLabel}
              </ThemedText>
            </Pressable>
          ),
      }}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    justifyContent: 'center',
    // Native headers inset their items; the web header does not.
    paddingHorizontal: Platform.OS === 'web' ? Spacing.three : 0,
  },
});
