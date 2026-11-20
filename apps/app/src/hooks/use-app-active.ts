import { focusManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}

const isActive = () => focusManager.isFocused();

export function useAppActive() {
  return useSyncExternalStore(focusManager.subscribe, isActive, isActive);
}
