import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SIGN_IN_STEPS = ['incoming', 'outgoing', 'contacts'] as const;
export type SignInStep = (typeof SIGN_IN_STEPS)[number];

type State = 'pending' | 'active' | 'done' | 'failed';

const ICON_SIZE = 18;

export function SignInSteps({ current, failed }: { current: SignInStep; failed: boolean }) {
  const { t } = useTranslation();
  const reached = SIGN_IN_STEPS.indexOf(current);
  const stateOf = (index: number): State => {
    if (index < reached) return 'done';
    if (index > reached) return 'pending';
    return failed ? 'failed' : 'active';
  };

  return (
    <View style={styles.list}>
      {SIGN_IN_STEPS.map((step, index) => {
        const state = stateOf(index);
        const label = t(`accounts.signIn.steps.${step}`);
        return (
          <View
            key={step}
            style={styles.row}
            accessible
            accessibilityLabel={t('accounts.signIn.stepState', { step: label, state: t(`accounts.signIn.state.${state}`) })}>
            <StepIcon state={state} />
            <ThemedText themeColor={state === 'pending' ? 'muted' : state === 'failed' ? 'danger' : 'heading'}>
              {label}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

function StepIcon({ state }: { state: State }) {
  const theme = useTheme();
  if (state === 'active') return <ActivityIndicator size="small" color={theme.primary} style={styles.icon} />;
  if (state === 'done') {
    return <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={ICON_SIZE} tintColor={theme.primary} style={styles.icon} />;
  }
  if (state === 'failed') {
    return <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={ICON_SIZE} tintColor={theme.danger} style={styles.icon} />;
  }
  return <View style={[styles.icon, styles.dot, { backgroundColor: theme.outline }]} />;
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.oneHalf,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: (ICON_SIZE - 6) / 2,
  },
});
