import { useEffect, useRef, type ComponentRef } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Radius, Shadow, Spacing, WindowClass } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWebDialog, type Choice } from '@/utils/dialog';


// The browser's confirm() can only say OK and Cancel; this names each action, and Escape picks the cancel one.
export function WebDialog() {
  const dialog = useWebDialog((state) => state.open);
  const theme = useTheme();
  const narrow = useWindowDimensions().width < WindowClass.medium;
  const safe = useRef<ComponentRef<typeof View>>(null);

  useEffect(() => {
    if (dialog) safe.current?.focus();
  }, [dialog]);

  if (!dialog) return null;

  const pick = (choice?: Choice) => {
    useWebDialog.setState({ open: undefined });
    choice?.onPress?.();
  };
  const cancel = dialog.choices.find((choice) => choice.style === 'cancel');
  // Side by side the main action sits last, at the right; stacked on a phone it goes on top.
  const ordered = narrow ? dialog.choices.toReversed() : dialog.choices;

  return (
    <Modal transparent visible onRequestClose={() => pick(cancel)}>
      <View style={[styles.scrim, { backgroundColor: theme.scrim }]}>
        <View style={[styles.card, { backgroundColor: theme.page, borderColor: theme.border }]}>
          <ThemedText type="name" role="heading" style={styles.title}>
            {dialog.title}
          </ThemedText>
          <View style={narrow ? styles.stacked : styles.row}>
            {ordered.map((choice) => (
              <Button
                key={choice.label}
                ref={choice === cancel ? safe : undefined}
                label={choice.label}
                variant={choice.style ? 'outline' : 'primary'}
                destructive={choice.style === 'destructive'}
                onPress={() => pick(choice)}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    gap: Spacing.four,
    padding: Spacing.four,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.lg,
    boxShadow: Shadow.overlay,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  stacked: {
    gap: Spacing.two,
  },
});
