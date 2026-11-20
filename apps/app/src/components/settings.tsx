import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Hairline, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWebTopInset } from '@/hooks/use-web-sidebar';

// A plain ScrollView: on iOS, native tabs inset only the first ScrollView of a tab for the tab bar.
// On web, tab roots hide their header under the floating tab bar, so the title is drawn here.
export function SettingsScreen({ title, tabRoot = false, children }: { title: string; tabRoot?: boolean; children: ReactNode }) {
  const theme = useTheme();
  const inlineTitle = tabRoot && Platform.OS === 'web';
  const topInset = useWebTopInset();
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView
        style={{ backgroundColor: theme.page }}
        contentContainerStyle={[styles.scroll, inlineTitle && { paddingTop: topInset }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          {inlineTitle && (
            <ThemedText type="display" accessibilityRole="header">
              {title}
            </ThemedText>
          )}
          {children}
        </View>
      </ScrollView>
    </>
  );
}

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? flatten((child as ReactElement<{ children?: ReactNode }>).props.children)
      : [child],
  );
}

const isRow = (child: ReactNode) => isValidElement(child) && (child.type === Row || child.type === ToggleRow);

export function SectionTitle({ title }: { title: string }) {
  return (
    <ThemedText
      type={Platform.OS === 'ios' ? 'meta' : 'name'}
      themeColor={Platform.OS === 'android' ? 'primary' : undefined}
      style={Platform.OS === 'ios' && styles.iosTitle}
      accessibilityRole="header">
      {title}
    </ThemedText>
  );
}

// Runs of rows sit between hairlines that span the column's padding.
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  const blocks: ReactNode[][] = [];
  let previousWasRow = false;
  for (const child of flatten(children)) {
    if (isRow(child) && previousWasRow) blocks[blocks.length - 1].push(child);
    else blocks.push([child]);
    previousWasRow = isRow(child);
  }

  return (
    <View style={styles.section}>
      {title && <SectionTitle title={title} />}
      {blocks.map((block, index) =>
        isRow(block[0]) ? (
          <View key={index} style={[styles.rows, { borderTopColor: theme.border }]}>
            {block}
          </View>
        ) : (
          <Fragment key={index}>{block}</Fragment>
        ),
      )}
    </View>
  );
}

type RowProps = {
  title: string;
  detail?: string;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  loading?: boolean;
  leading?: ReactNode;
  // Set on the rows of a single choice: the row becomes a radio, checked when true.
  selected?: boolean;
};

export function Row({ title, detail, onPress, chevron, destructive, loading, leading, selected }: RowProps) {
  const theme = useTheme();
  const radio = selected !== undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || loading}
      accessibilityRole={radio ? 'radio' : onPress ? 'button' : undefined}
      accessibilityLabel={[title, detail].filter(Boolean).join(', ')}
      accessibilityState={radio ? { checked: selected } : loading ? { busy: true } : undefined}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.border },
        pressed && { backgroundColor: theme.surface },
      ]}>
      {leading}
      <RowText title={title} detail={detail} titleColor={destructive ? 'danger' : 'heading'} />
      {loading && <ActivityIndicator color={theme.muted} />}
      {selected && (
        <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.primary} />
      )}
      {chevron && (
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={14}
          tintColor={theme.muted}
        />
      )}
    </Pressable>
  );
}

type ToggleRowProps = {
  title: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

// react-native-web paints the thumb of a switch that is on with activeThumbColor, which React Native's types leave out.
const webThumb = (color: string) => (Platform.OS === 'web' ? { activeThumbColor: color } : {});

// The whole row toggles, and carries the switch semantics, so the Switch itself is hidden from screen readers.
export function ToggleRow({ title, detail, value, onValueChange, disabled }: ToggleRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.border },
        pressed && { backgroundColor: theme.surface },
      ]}>
      <RowText title={title} detail={detail} titleColor="heading" />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: theme.primary }}
          {...webThumb(theme.onPrimary)}
        />
      </View>
    </Pressable>
  );
}

function RowText({ title, detail, titleColor }: { title: string; detail?: string; titleColor: 'heading' | 'danger' }) {
  return (
    <View style={styles.rowText}>
      <ThemedText themeColor={titleColor}>{title}</ThemedText>
      {detail ? <ThemedText type="meta">{detail}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  column: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ColumnWidth,
    padding: Spacing.three,
    gap: Spacing.five,
  },
  section: {
    gap: Spacing.two,
  },
  iosTitle: {
    textTransform: 'uppercase',
  },
  rows: {
    marginHorizontal: -Spacing.three,
    borderTopWidth: Hairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
    borderBottomWidth: Hairline,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
