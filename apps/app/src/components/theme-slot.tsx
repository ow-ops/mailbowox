import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { Row, Section } from '@/components/settings';
import { ThemeSwatches } from '@/components/theme-swatches';
import { Colors } from '@/constants/theme';
import { useThemeState } from '@/hooks/use-theme';
import { resolvePalette, selectAccountTheme, selectTheme, themeColors } from '@/theme/store';
import { parseThemeFile, type ThemeKind } from '@/theme/theme-file';

// The app's theme for one kind, or with `account` (a lowercased email) that account's own.
export function ThemeSlot({ kind, account }: { kind: ThemeKind; account?: string }) {
  const { t } = useTranslation();
  const state = useThemeState();
  const themes = state.themes.filter((custom) => custom.kind === kind);
  const selected = account ? state.byAccount[account]?.[kind] : (state.selected[kind] ?? null);
  const choose = (id: string | null) => (account ? selectAccountTheme(account, kind, id) : selectTheme(kind, id));

  return (
    <Section
      title={kind === 'light' ? t('settings.themes.lightTheme') : t('settings.themes.darkTheme')}
      footer={
        themes.length === 0
          ? kind === 'light'
            ? t('settings.themes.noneLight')
            : t('settings.themes.noneDark')
          : undefined
      }>
      {account && (
        <Row
          title={t('settings.accountTheme.same')}
          selected={selected === undefined}
          leading={<ThemeSwatches colors={resolvePalette(state, kind)} />}
          onPress={() => selectAccountTheme(account, kind, undefined)}
        />
      )}
      <Row
        title={t('settings.themes.default')}
        selected={selected === null}
        leading={<ThemeSwatches colors={Colors[kind]} />}
        onPress={() => choose(null)}
      />
      {themes.map((custom) => {
        const file = parseThemeFile(custom.css);
        return (
          <Row
            key={custom.id}
            title={custom.name}
            detail={typeof file === 'string' ? undefined : (file.meta.author ?? undefined)}
            selected={selected === custom.id}
            leading={<ThemeSwatches colors={themeColors(custom.css, kind)} />}
            trailing={
              account ? undefined : (
                <Button
                  label={t('common.edit')}
                  size="small"
                  variant="outline"
                  onPress={() => router.push({ pathname: '/theme-editor', params: { id: custom.id } })}
                />
              )
            }
            onPress={() => choose(custom.id)}
          />
        );
      })}
    </Section>
  );
}
