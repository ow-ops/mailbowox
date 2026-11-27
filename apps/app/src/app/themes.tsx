import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';

import { accountLabel } from '@/accounts/colors';
import { Button } from '@/components/button';
import { Row, Section, SettingsScreen } from '@/components/settings';
import { ThemeSlot } from '@/components/theme-slot';
import { Spacing } from '@/constants/theme';
import { useTheme, useThemeState } from '@/hooks/use-theme';
import { useShownAccount } from '@/mail/view';
import { importThemeFile } from '@/theme/import-file';
import { removeTweak, setTweakEnabled } from '@/theme/store';
import { confirmAction } from '@/utils/dialog';

export default function ThemesScreen() {
  const { t } = useTranslation();
  const state = useThemeState();
  const theme = useTheme();
  const shown = useShownAccount();
  const ownTheme = shown && state.byAccount[shown.email.toLowerCase()];

  return (
    <SettingsScreen title={t('settings.themes.title')}>
      {shown && ownTheme && (
        <Section>
          <Row
            title={t('settings.accountTheme.note', { label: accountLabel(shown) })}
            chevron
            onPress={() => router.push({ pathname: '/account-theme', params: { id: shown.id } })}
          />
        </Section>
      )}

      <ThemeSlot kind="light" />
      <ThemeSlot kind="dark" />

      {state.tweaks.length > 0 && (
        <Section title={t('settings.tweaks.title')} footer={t('settings.tweaks.hint')}>
          {state.tweaks.map((tweak) => (
            <Row
              key={tweak.id}
              title={tweak.name}
              trailing={
                <View style={styles.tweakActions}>
                  <Button
                    label={t('common.remove')}
                    accessibilityLabel={t('settings.tweaks.removeLabel', { name: tweak.name })}
                    size="small"
                    variant="outline"
                    onPress={() =>
                      confirmAction(t('settings.tweaks.removeConfirm', { name: tweak.name }), t('common.remove'), () =>
                        removeTweak(tweak.id),
                      )
                    }
                  />
                  <Switch
                    value={tweak.enabled}
                    onValueChange={(enabled) => setTweakEnabled(tweak.id, enabled)}
                    trackColor={{ true: theme.primary }}
                    accessibilityLabel={t('settings.tweaks.useLabel', { name: tweak.name })}
                  />
                </View>
              }
            />
          ))}
        </Section>
      )}

      <View style={styles.actions}>
        <Button label={t('settings.themes.browse')} onPress={() => router.push('/theme-catalog')} />
        <Button label={t('settings.themes.new')} variant="outline" onPress={() => router.push('/theme-editor')} />
        <Button label={t('settings.themes.import')} variant="outline" onPress={importThemeFile} />
      </View>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.two,
  },
  tweakActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
