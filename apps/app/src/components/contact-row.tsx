import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { hrefParam } from '@/utils/href-param';
import { ContactAvatar } from '@/components/contact-avatar';
import { ThemedText } from '@/components/themed-text';
import { Hairline, Spacing } from '@/constants/theme';
import type { ContactRow as Row } from '@/core';
import { useTheme } from '@/hooks/use-theme';

export function ContactRow({ contact }: { contact: Row }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const name = contact.name || contact.email || t('contacts.untitled');
  const detail = contact.organization ?? (contact.name ? contact.email : undefined);

  return (
    <Link href={{ pathname: '/contact', params: { account: contact.account, href: hrefParam(contact.href) } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={[name, detail].filter(Boolean).join(', ')}>
        {({ pressed }) => (
          // Styled inside: Link's Slot drops a style function on the Pressable itself.
          <View
            style={[
              styles.row,
              { borderBottomColor: theme.border, backgroundColor: pressed ? theme.surface : theme.page },
            ]}>
            <ContactAvatar name={name} email={contact.email} />
            <View style={styles.text}>
              <ThemedText type="label" numberOfLines={1}>
                {name}
              </ThemedText>
              {!!detail && (
                <ThemedText type="meta" numberOfLines={1}>
                  {detail}
                </ThemedText>
              )}
            </View>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.oneHalf,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: Hairline,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});
