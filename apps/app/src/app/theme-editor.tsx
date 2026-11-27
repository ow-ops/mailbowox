import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ColorSwatch } from '@/components/color-swatch';
import { Section, SettingsScreen } from '@/components/settings';
import { TextField } from '@/components/text-field';
import { ThemedText, textStyles } from '@/components/themed-text';
import { BorderWidth, Colors, Fonts, Hairline, Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useScheme, useTheme, useThemeState } from '@/hooks/use-theme';
import { t as translate } from '@/i18n';
import { CONTRAST_PAIRS, contrastRatio } from '@/theme/contrast';
import { shareThemeFile, themeLink } from '@/theme/share';
import {
  removeTheme,
  saveTheme,
  selectTheme,
  themeColors,
  type CustomTheme,
  type Palette,
} from '@/theme/store';
import { isColor, parseThemeFile, serializeThemeFile, TOKENS, type ThemeKind } from '@/theme/theme-file';
import { confirmAction } from '@/utils/dialog';
import { showError } from '@/utils/toast';

const tokenLabel = (token: ThemeColor) => translate(`settings.themeEditor.tokens.${token}`);

// Without an id, a new theme starting from the built-in colors of the current appearance.
export default function ThemeEditor() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useThemeState().themes.find((custom) => custom.id === id);
  const scheme = useScheme();
  const meta = existing ? parseThemeFile(existing.css) : null;

  const [name, setName] = useState(existing?.name ?? t('settings.themeEditor.defaultName'));
  const [author, setAuthor] = useState(meta && typeof meta !== 'string' ? (meta.meta.author ?? '') : '');
  const [kind, setKind] = useState<ThemeKind>(existing?.kind ?? scheme);
  const [colors, setColors] = useState<Palette>(() =>
    existing ? themeColors(existing.css, existing.kind) : { ...Colors[scheme] },
  );

  const invalid = TOKENS.filter((token) => !isColor(colors[token]));
  const themeName = name.trim() || t('settings.themeEditor.defaultName');
  const css = serializeThemeFile({
    type: 'theme',
    meta: { name: themeName, author: author.trim() || null, description: null, kind, contrast: 'low', tags: [] },
    tokens: colors,
  });

  // Saving makes the theme local, so a catalog refresh will not overwrite the edits.
  const save = () => {
    const theme = { id: existing?.id ?? randomUUID(), name: themeName, kind, css };
    saveTheme(theme);
    selectTheme(kind, theme.id);
    router.back();
  };

  const remove = (theme: CustomTheme) =>
    confirmAction(t('settings.themeEditor.deleteConfirm', { name: theme.name }), t('common.delete'), () => {
      removeTheme(theme.id);
      router.back();
    });

  const exportFile = () =>
    shareThemeFile(themeName, css).catch((error: unknown) =>
      showError(t('common.actionFailed'), error instanceof Error ? error.message : undefined),
    );

  return (
    <SettingsScreen title={existing ? t('settings.themeEditor.editTitle') : t('settings.themeEditor.newTitle')}>
      <Preview colors={colors} />

      <Section title={t('settings.themeEditor.about')}>
        <Field label={t('settings.themeEditor.name')} value={name} onChange={setName} />
        <Field
          label={t('settings.themeEditor.author')}
          value={author}
          onChange={setAuthor}
          placeholder={t('settings.themeEditor.optional')}
        />
        <View style={styles.choices} accessibilityRole="radiogroup">
          {(['light', 'dark'] as const).map((k) => (
            <Button
              key={k}
              label={k === 'light' ? t('settings.themes.lightTheme') : t('settings.themes.darkTheme')}
              size="small"
              role="radio"
              variant="outline"
              selected={kind === k}
              onPress={() => setKind(k)}
            />
          ))}
        </View>
      </Section>

      <Section title={t('settings.themeEditor.colors')}>
        {TOKENS.map((token) => (
          <ColorRow
            key={token}
            label={tokenLabel(token)}
            value={colors[token]}
            onChange={(value) => setColors((c) => ({ ...c, [token]: value }))}
          />
        ))}
      </Section>

      <ContrastWarnings colors={colors} />

      <View style={styles.actions}>
        <Button label={t('settings.themeEditor.saveAndUse')} onPress={save} disabled={invalid.length > 0} />
        {invalid.length > 0 && (
          <ThemedText themeColor="danger">
            {t('settings.themeEditor.invalidColors', { colors: invalid.map(tokenLabel).join(', ') })}
          </ThemedText>
        )}
        <Button
          label={t('settings.themeEditor.shareLink')}
          variant="outline"
          disabled={invalid.length > 0}
          onPress={() => Share.share({ message: themeLink(css) })}
        />
        <Button
          label={t('settings.themeEditor.export')}
          variant="outline"
          disabled={invalid.length > 0}
          onPress={exportFile}
        />
        {existing && <Button label={t('settings.themeEditor.delete')} variant="outline" destructive onPress={() => remove(existing)} />}
      </View>
    </SettingsScreen>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="meta">{label}</ThemedText>
      <TextField value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label} />
    </View>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const valid = isColor(value);
  return (
    <View style={styles.colorRow}>
      <ColorSwatch color={valid ? value : 'transparent'} label={label} onChange={onChange} />
      <ThemedText style={styles.colorLabel} numberOfLines={2}>
        {label}
      </ThemedText>
      <TextField
        value={value}
        onChangeText={(text) => onChange(text.trim())}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('settings.themeEditor.colorLabel', { label })}
        accessibilityHint={t('settings.themeEditor.colorHint')}
        style={[styles.hex, { borderColor: valid ? theme.outline : theme.danger }]}
      />
    </View>
  );
}

// Drawn with the colors being edited, not the app's current theme: a selected and a plain message, a field and buttons.
function Preview({ colors }: { colors: Palette }) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.preview, { backgroundColor: colors.page, borderColor: colors.border }]}
      accessibilityLabel={t('settings.themeEditor.preview')}>
      <View style={[styles.previewRow, { backgroundColor: colors.accentSoft }]}>
        <ThemedText type="name" style={{ color: colors.onAccentSoft }}>
          {t('settings.themeEditor.previewSender')}
        </ThemedText>
        <ThemedText style={{ color: colors.onAccentSoft }}>{t('settings.themeEditor.previewSubject')}</ThemedText>
      </View>
      <View style={[styles.previewRow, { borderBottomColor: colors.border, borderBottomWidth: Hairline }]}>
        <ThemedText type="name" style={{ color: colors.heading }}>
          {t('settings.themeEditor.previewSender')}
        </ThemedText>
        <ThemedText style={{ color: colors.text }}>{t('settings.themeEditor.previewSubject')}</ThemedText>
        <ThemedText type="meta" style={{ color: colors.muted }}>
          {t('settings.themeEditor.previewSnippet')}
        </ThemedText>
      </View>
      <View style={[styles.previewField, { backgroundColor: colors.field, borderColor: colors.outline }]}>
        <ThemedText style={{ color: colors.heading }}>{t('settings.themeEditor.previewSubject')}</ThemedText>
      </View>
      <View style={[styles.previewCard, { backgroundColor: colors.surface }]}>
        <View style={[styles.previewButton, { backgroundColor: colors.primary }]}>
          <ThemedText type="label" style={{ color: colors.onPrimary }}>
            {t('settings.themeEditor.previewSend')}
          </ThemedText>
        </View>
        <View style={[styles.previewButton, { borderColor: colors.danger, borderWidth: BorderWidth.input }]}>
          <ThemedText type="label" style={{ color: colors.danger }}>
            {t('settings.themeEditor.previewDelete')}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

function ContrastWarnings({ colors }: { colors: Palette }) {
  const { t } = useTranslation();
  const low = CONTRAST_PAIRS.flatMap(([fg, bg, min]) => {
    const ratio = contrastRatio(colors[fg], colors[bg]);
    return ratio !== null && ratio < min
      ? [
          t('settings.themeEditor.contrastPair', {
            foreground: tokenLabel(fg),
            background: tokenLabel(bg).toLowerCase(),
            ratio: ratio.toFixed(1),
            min,
          }),
        ]
      : [];
  });
  if (low.length === 0) return null;
  return (
    <Section title={t('settings.themeEditor.lowContrast')}>
      <ThemedText type="meta">{t('settings.themeEditor.lowContrastHint')}</ThemedText>
      {low.map((line) => (
        <ThemedText key={line} themeColor="danger">
          {line}
        </ThemedText>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  choices: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actions: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  colorLabel: {
    flex: 1,
  },
  hex: {
    width: 120,
    ...textStyles.meta,
    fontFamily: Fonts.mono,
  },
  preview: {
    borderWidth: Hairline,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  previewRow: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    padding: Spacing.oneHalf,
    gap: Spacing.half,
  },
  previewField: {
    borderWidth: BorderWidth.input,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    padding: Spacing.oneHalf,
  },
  previewCard: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.oneHalf,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  previewButton: {
    minHeight: 40,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
