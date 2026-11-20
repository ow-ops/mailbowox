import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { hrefParam } from '@/utils/href-param';
import { Button } from '@/components/button';
import { ContactAvatar } from '@/components/contact-avatar';
import { SectionTitle } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Fonts, Hairline, Spacing } from '@/constants/theme';
import { useDeleteContact } from '@/contacts/actions';
import type { ContactRef, StoredContact } from '@/contacts/db';
import { displayName, embeddedPhoto, kindLabel } from '@/contacts/format';
import { useAddressBooks, useContact } from '@/contacts/queries';
import type { ContactValue } from '@/core';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/utils/dialog';

// `onClose` runs once the contact is gone: deleted here, or removed on the server.
export function ContactDetail({ account, href, onClose }: ContactRef & { onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { data: item, isPending, isSuccess } = useContact({ account, href });
  const gone = isSuccess && !item;

  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  if (isPending) return <ActivityIndicator color={theme.muted} style={styles.loading} />;
  if (!item) {
    return (
      <ThemedText themeColor="muted" style={styles.loading}>
        {t('contacts.detail.gone')}
      </ThemedText>
    );
  }
  return <Detail item={item} />;
}

function Detail({ item }: { item: StoredContact }) {
  const { t } = useTranslation();
  const del = useDeleteContact();
  const { account, contact } = item;
  const book = useAddressBooks().data?.find((b) => b.account === account && b.href === item.book);
  const readOnly = !book || book.readOnly;
  const name = displayName(contact) || t('contacts.untitled');

  return (
    <ScrollView contentContainerStyle={styles.scroll} contentInsetAdjustmentBehavior="automatic">
      <View style={styles.content}>
        <View style={styles.header}>
          <ContactAvatar name={name} photo={embeddedPhoto(contact.photo)} size={72} />
          <View style={styles.headerText}>
            <ThemedText themeColor="heading" style={styles.title} accessibilityRole="header">
              {name}
            </ThemedText>
            {!!contact.organization && <ThemedText themeColor="muted">{contact.organization}</ThemedText>}
          </View>
        </View>

        {contact.emails.length > 0 && (
          <Group title={t('contacts.detail.emails')}>
            {contact.emails.map((email) => (
              <EmailLine key={email.value} email={email} account={account} />
            ))}
          </Group>
        )}
        {contact.phones.length > 0 && (
          <Group title={t('contacts.detail.phones')}>
            {contact.phones.map((phone) => (
              <Line key={phone.value} entry={phone}>
                <ThemedText selectable>{phone.value}</ThemedText>
              </Line>
            ))}
          </Group>
        )}

        <View style={styles.actions}>
          {readOnly ? (
            <ThemedText type="meta">{t('contacts.detail.readOnly')}</ThemedText>
          ) : (
            <ThemedText type="meta">{t('contacts.detail.inBook', { name: book.name })}</ThemedText>
          )}
          <Button
            label={t('contacts.detail.edit')}
            disabled={readOnly}
            onPress={() =>
              router.push({ pathname: '/contact-edit', params: { account, href: hrefParam(contact.href) } })
            }
          />
          <Button
            label={t('contacts.detail.delete')}
            variant="outline"
            destructive
            disabled={readOnly}
            loading={del.isPending}
            onPress={() =>
              confirmAction(t('contacts.detail.deleteConfirm'), t('contacts.detail.delete'), () =>
                del.mutate({ account, contact }),
              )
            }
          />
        </View>
      </View>
    </ScrollView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionTitle title={title} />
      <View>{children}</View>
    </View>
  );
}

function Line({ entry, children }: { entry: ContactValue; children: React.ReactNode }) {
  const theme = useTheme();
  const label = kindLabel(entry.kind);
  return (
    <View style={[styles.line, { borderBottomColor: theme.border }]}>
      {!!label && <ThemedText type="meta">{label}</ThemedText>}
      {children}
    </View>
  );
}

function EmailLine({ email, account }: { email: ContactValue; account: string }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/compose', params: { account, to: email.value } })}
      accessibilityRole="link"
      accessibilityLabel={t('contacts.detail.email', { email: email.value })}>
      <Line entry={email}>
        <ThemedText themeColor="primary">{email.value}</ThemedText>
      </Line>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: Spacing.five,
    textAlign: 'center',
  },
  scroll: {
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: ColumnWidth,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  group: {
    gap: Spacing.one,
  },
  line: {
    gap: Spacing.half,
    paddingVertical: Spacing.oneHalf,
    borderBottomWidth: Hairline,
  },
  actions: {
    gap: Spacing.two,
  },
});
