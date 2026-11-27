import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { MenuPicker, type MenuPickerProps } from '@/components/menu-picker';
import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Hairline, Radius, Spacing, TouchTarget } from '@/constants/theme';
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

const isRow = (child: ReactNode) =>
  isValidElement(child) && (child.type === Row || child.type === ToggleRow || child.type === ChoiceRow);

export function SectionTitle({ title }: { title: string }) {
  return (
    <ThemedText
      type={Platform.select({ ios: 'meta', android: 'name', default: 'labelSmall' })}
      themeColor={Platform.select({ ios: 'muted', android: 'primary', default: 'text' })}
      style={Platform.OS === 'ios' && styles.iosTitle}
      accessibilityRole="header">
      {title}
    </ThemedText>
  );
}

// Runs of rows share one card, divided by hairlines inset to the text. A footer explains the section under its rows.
export function Section({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
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
      {title && (
        <View style={styles.inset}>
          <SectionTitle title={title} />
        </View>
      )}
      {blocks.map((block, index) =>
        isRow(block[0]) ? (
          <View key={index} style={[styles.card, { backgroundColor: theme.surface }]}>
            {block.map((row, at) => (
              <Fragment key={at}>
                {at > 0 && <View style={[styles.divider, { backgroundColor: theme.border }]} />}
                {row}
              </Fragment>
            ))}
          </View>
        ) : (
          <Fragment key={index}>{block}</Fragment>
        ),
      )}
      {typeof footer === 'string' ? (
        <ThemedText type="meta" style={styles.inset}>
          {footer}
        </ThemedText>
      ) : (
        footer && <View style={styles.inset}>{footer}</View>
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
  value?: string;
  trailing?: ReactNode;
  // Set on the rows of a single choice: the row becomes a radio, checked when true.
  selected?: boolean;
};

export function Row({ title, detail, onPress, chevron, destructive, loading, leading, value, trailing, selected }: RowProps) {
  const theme = useTheme();
  const radio = selected !== undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || loading}
      accessibilityRole={radio ? 'radio' : onPress ? 'button' : undefined}
      accessibilityLabel={[title, detail, value].filter(Boolean).join(', ')}
      accessibilityState={radio ? { checked: selected } : loading ? { busy: true } : undefined}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.border }]}>
      {leading}
      <RowText title={title} detail={detail} titleColor={destructive ? 'danger' : 'heading'} />
      {value ? (
        <ThemedText themeColor="muted" numberOfLines={1} style={styles.value}>
          {value}
        </ThemedText>
      ) : null}
      {loading && <ActivityIndicator color={theme.muted} />}
      {trailing}
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
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.border }]}>
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

type ChoiceRowProps<T extends string> = Omit<MenuPickerProps<T>, 'label' | 'fill'> & { title: string; detail?: string };

// The picker carries the title for screen readers, so the row's own copy is hidden from them.
export function ChoiceRow<T extends string>({ title, detail, ...picker }: ChoiceRowProps<T>) {
  return (
    <View style={styles.row}>
      <RowText title={title} detail={detail} titleColor="heading" titleHidden />
      <MenuPicker label={title} fill {...picker} />
    </View>
  );
}

type RowTextProps = { title: string; detail?: string; titleColor: 'heading' | 'danger'; titleHidden?: boolean };

function RowText({ title, detail, titleColor, titleHidden }: RowTextProps) {
  return (
    <View style={styles.rowText}>
      <ThemedText themeColor={titleColor} aria-hidden={titleHidden}>
        {title}
      </ThemedText>
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
  inset: {
    paddingHorizontal: Spacing.three,
  },
  card: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  divider: {
    height: Hairline,
    marginLeft: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: TouchTarget + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
  },
  value: {
    flexShrink: 1,
    maxWidth: '50%',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
