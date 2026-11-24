import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { EnrichedTextInput, type EnrichedTextInputInstance } from 'react-native-enriched-html';

import { IconButton } from '@/components/icon-button';
import { textStyles } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  ref: RefObject<EnrichedTextInputInstance | null>;
  defaultValue: string;
  label: string;
  autoFocus?: boolean;
  onChange: (change: { html?: string; text?: string }) => void;
  minHeight?: number;
};

// Formatted text, kept as HTML; the plain text goes along for mail clients that show only that.
export function RichBody({ ref, defaultValue, label, autoFocus, onChange, minHeight = 200 }: Props) {
  const theme = useTheme();
  return (
    <EnrichedTextInput
      ref={ref}
      defaultValue={defaultValue}
      placeholder={label}
      accessibilityLabel={label}
      placeholderTextColor={theme.muted}
      selectionColor={theme.primary}
      cursorColor={theme.primary}
      autoFocus={autoFocus}
      onChangeHtml={({ nativeEvent }) => onChange({ html: nativeEvent.value })}
      onChangeText={({ nativeEvent }) => onChange({ text: nativeEvent.value })}
      htmlStyle={{
        blockquote: { borderColor: theme.outline, borderWidth: 2, gapWidth: Spacing.three },
        a: { color: theme.primary },
      }}
      style={{
        ...textStyles.body,
        fontFamily: Platform.select({ web: 'system-ui' }),
        color: theme.heading,
        minHeight,
        paddingHorizontal: Spacing.three,
        paddingVertical: Spacing.two,
      }}
    />
  );
}

type Editor = EnrichedTextInputInstance;

const FORMATS = [
  { key: 'bold', ios: 'bold', material: 'format_bold', run: (e: Editor) => e.toggleBold() },
  { key: 'italic', ios: 'italic', material: 'format_italic', run: (e: Editor) => e.toggleItalic() },
  { key: 'underline', ios: 'underline', material: 'format_underlined', run: (e: Editor) => e.toggleUnderline() },
  { key: 'bullets', ios: 'list.bullet', material: 'format_list_bulleted', run: (e: Editor) => e.toggleUnorderedList() },
  { key: 'numbers', ios: 'list.number', material: 'format_list_numbered', run: (e: Editor) => e.toggleOrderedList() },
  { key: 'quote', ios: 'text.quote', material: 'format_quote', run: (e: Editor) => e.toggleBlockQuote() },
] as const;

export function FormatBar({ editor }: { editor: RefObject<Editor | null> }) {
  const { t } = useTranslation();
  return (
    <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel={t('compose.format.label')}>
      {FORMATS.map(({ key, ios, material, run }) => (
        <IconButton
          key={key}
          icon={{ ios, android: material, web: material }}
          label={t(`compose.format.${key}`)}
          onPress={() => {
            if (editor.current) run(editor.current);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ bar: { flexDirection: 'row' } });
