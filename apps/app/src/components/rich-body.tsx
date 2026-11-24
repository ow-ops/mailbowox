import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeSelectionEvent,
} from 'react-native-enriched-html';

import { Button } from '@/components/button';
import { IconButton } from '@/components/icon-button';
import { TextField } from '@/components/text-field';
import { textStyles } from '@/components/themed-text';
import { BorderWidth, ColumnWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Editor = EnrichedTextInputInstance;

// The editor and where its selection is, which the link button reads.
type EditorRefs = { editorRef: RefObject<Editor | null>; selectionRef: RefObject<OnChangeSelectionEvent> };

export function useRichEditor(): EditorRefs {
  const editorRef = useRef<Editor>(null);
  const selectionRef = useRef<OnChangeSelectionEvent>({ start: 0, end: 0, text: '' });
  return { editorRef, selectionRef };
}

type Props = EditorRefs & {
  defaultValue: string;
  label: string;
  autoFocus?: boolean;
  onChange: (html: string) => void;
  minHeight?: number;
  // Drawn as a form field, like TextField, rather than as a page of the composer.
  field?: boolean;
};

export function RichBody(props: Props) {
  const { editorRef, selectionRef, defaultValue, label, autoFocus, onChange, minHeight = 200, field } = props;
  const theme = useTheme();
  return (
    <EnrichedTextInput
      ref={editorRef}
      defaultValue={defaultValue}
      placeholder={label}
      accessibilityLabel={label}
      placeholderTextColor={theme.muted}
      selectionColor={theme.primary}
      cursorColor={theme.primary}
      autoFocus={autoFocus}
      onChangeHtml={({ nativeEvent }) => onChange(nativeEvent.value)}
      onChangeSelection={({ nativeEvent }) => {
        selectionRef.current = nativeEvent;
      }}
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
        ...(field && {
          borderWidth: BorderWidth.input,
          borderRadius: Radius.md,
          borderCurve: 'continuous',
          borderColor: theme.outline,
          backgroundColor: theme.field,
        }),
      }}
    />
  );
}

const FORMATS = [
  { key: 'bold', ios: 'bold', material: 'format_bold', run: (e: Editor) => e.toggleBold() },
  { key: 'italic', ios: 'italic', material: 'format_italic', run: (e: Editor) => e.toggleItalic() },
  { key: 'underline', ios: 'underline', material: 'format_underlined', run: (e: Editor) => e.toggleUnderline() },
  { key: 'bullets', ios: 'list.bullet', material: 'format_list_bulleted', run: (e: Editor) => e.toggleUnorderedList() },
  { key: 'numbers', ios: 'list.number', material: 'format_list_numbered', run: (e: Editor) => e.toggleOrderedList() },
  { key: 'quote', ios: 'text.quote', material: 'format_quote', run: (e: Editor) => e.toggleBlockQuote() },
] as const;

// A typed address without a scheme is taken for a web address.
const linkUrl = (typed: string) => (/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`);

export function FormatBar({ editorRef, selectionRef }: EditorRefs) {
  const { t } = useTranslation();
  // The address being typed for a link, while the field for it is open.
  const [link, setLink] = useState<string>();

  const addLink = () => {
    const typed = link?.trim();
    if (!typed) return;
    const url = linkUrl(typed);
    const { start, end, text } = selectionRef.current;
    editorRef.current?.setLink(start, end, text || url, url);
    setLink(undefined);
  };

  return (
    <View style={styles.formats}>
      <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel={t('compose.format.label')}>
        {FORMATS.map(({ key, ios, material, run }) => (
          <IconButton
            key={key}
            icon={{ ios, android: material, web: material }}
            label={t(`compose.format.${key}`)}
            onPress={() => {
              if (editorRef.current) run(editorRef.current);
            }}
          />
        ))}
        <IconButton
          icon={{ ios: 'link', android: 'link', web: 'link' }}
          label={t('compose.format.link')}
          active={link !== undefined}
          onPress={() => setLink(link === undefined ? '' : undefined)}
        />
      </View>
      {link !== undefined && (
        <View style={styles.link}>
          <TextField
            value={link}
            onChangeText={setLink}
            placeholder="https://"
            accessibilityLabel={t('compose.format.url')}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={addLink}
            style={styles.url}
          />
          <Button label={t('compose.format.addLink')} size="small" disabled={!link.trim()} onPress={addLink} />
          <Button label={t('common.cancel')} variant="outline" size="small" onPress={() => setLink(undefined)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  formats: { width: '100%', maxWidth: ColumnWidth },
  // The glyphs line up with what is below them, not their touch areas.
  bar: { flexDirection: 'row', marginLeft: -Spacing.oneHalf },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  url: { flex: 1 },
});
