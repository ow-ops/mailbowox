import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { Platform } from 'react-native';

// Keyed by KeyboardEvent.key.
export type Shortcuts = Partial<Record<string, () => void>>;

type KeyPress = Pick<KeyboardEvent, 'key' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented'>;

const typing = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
};

// Keys typed into a field and browser shortcuts are left alone, and Enter presses a focused control instead.
export function shortcutFor(event: KeyPress, shortcuts: Shortcuts, body: EventTarget | null) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
  if (event.key === 'Enter' && event.target !== body) return;
  return shortcuts[event.key];
}

// Single-key shortcuts on web, live while the screen is the focused one.
export function useShortcuts(shortcuts: Shortcuts) {
  const focused = useIsFocused();
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const run = shortcutFor(event, shortcuts, document.body);
    if (!run) return;
    event.preventDefault();
    run();
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || !focused) return;
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focused]);
}
