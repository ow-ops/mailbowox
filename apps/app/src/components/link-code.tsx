import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export function LinkCode({ code }: { code: string }) {
  return (
    <ThemedText
      type="title"
      selectable={false}
      accessibilityLabel={code.split('').join(' ')}
      style={styles.code}>
      {`${code.slice(0, 3)} ${code.slice(3)}`}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  code: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
});
