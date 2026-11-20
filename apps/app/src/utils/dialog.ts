import { Alert, Platform } from 'react-native';
import { create } from 'zustand';

import { t } from '@/i18n';

export type Choice = { label: string; style?: 'cancel' | 'destructive'; onPress?: () => void };

// What the web shows in place of a native alert; the WebDialog component renders it.
export const useWebDialog = create<{ open?: { title: string; choices: Choice[] } }>(() => ({}));

export function ask(title: string, choices: Choice[]) {
  if (Platform.OS === 'web') return useWebDialog.setState({ open: { title, choices } });
  Alert.alert(
    title,
    undefined,
    choices.map(({ label, style, onPress }) => ({ text: label, style, onPress })),
  );
}

export function confirmAction(title: string, action: string, run: () => void) {
  ask(title, [
    { label: t('common.cancel'), style: 'cancel' },
    { label: action, style: 'destructive', onPress: run },
  ]);
}
