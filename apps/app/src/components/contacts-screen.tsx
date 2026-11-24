import { FlashList } from '@shopify/flash-list';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { ContactRow } from '@/components/contact-row';
import { IconButton } from '@/components/icon-button';
import { NoContacts } from '@/components/no-contacts';
import { OfflineBanner } from '@/components/offline-banner';
import { QueryState } from '@/components/query-state';
import { SyncFailureBanners, useSyncRefresh } from '@/components/sync-status';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Hairline, Spacing } from '@/constants/theme';
import type { ContactRow as Row } from '@/core';
import { letterOf } from '@/contacts/format';
import { useAddressBooks, useContacts } from '@/contacts/queries';
import { syncContacts, useContactsSync } from '@/contacts/sync';
import { useTheme } from '@/hooks/use-theme';
import { useWebTopInset } from '@/hooks/use-web-sidebar';

type Item = { kind: 'letter'; letter: string } | { kind: 'contact'; contact: Row };

function withLetters(contacts: Row[]) {
  const items: Item[] = [];
  let letter = '';
  for (const contact of contacts) {
    if (letterOf(contact.sort) !== letter) {
      letter = letterOf(contact.sort);
      items.push({ kind: 'letter', letter });
    }
    items.push({ kind: 'contact', contact });
  }
  return items;
}

export function ContactsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const books = useAddressBooks();
  const topInset = useWebTopInset();
  const { errors, syncing } = useContactsSync();

  const add = (
    <IconButton
      icon={{ ios: 'plus', android: 'add', web: 'add' }}
      label={t('contacts.add')}
      active
      onPress={() => router.push('/contact-edit')}
    />
  );

  if (books.isPending) return <ActivityIndicator color={theme.muted} style={styles.loading} />;

  return (
    <>
      <Stack.Screen options={{ headerRight: () => add }} />
      <View style={[styles.screen, { backgroundColor: theme.page }]}>
        {books.data?.length ? (
          <View style={styles.column}>
            <ContactList
              errors={errors}
              header={
                Platform.OS === 'web' ? (
                  <View style={[styles.inline, { paddingTop: topInset }]}>
                    <ThemedText type="display" accessibilityRole="header">
                      {t('contacts.tab')}
                    </ThemedText>
                    {add}
                  </View>
                ) : undefined
              }
            />
          </View>
        ) : (
          <NoContacts syncing={syncing} />
        )}
      </View>
    </>
  );
}

function ContactList({ header, errors }: { header?: React.ReactElement; errors: Record<string, unknown> }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const refreshControl = useSyncRefresh(syncContacts, t('contacts.refreshFailed'));
  const [query, setQuery] = useState('');
  const contacts = useContacts(query);
  const items = withLetters(contacts.data ?? []);

  return (
    <FlashList
      data={items}
      stickyHeaderIndices={items.flatMap((item, index) => (item.kind === 'letter' ? [index] : []))}
      getItemType={(item) => item.kind}
      keyExtractor={(item) => (item.kind === 'letter' ? item.letter : `${item.contact.account}/${item.contact.href}`)}
      renderItem={({ item }) =>
        item.kind === 'letter' ? <Letter letter={item.letter} /> : <ContactRow contact={item.contact} />
      }
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      style={{ backgroundColor: theme.page }}
      ListHeaderComponent={
        <>
          {header}
          <OfflineBanner />
          <SyncFailureBanners errors={errors} title={(email) => t('contacts.syncFailed', { email })} />
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder={t('contacts.search.placeholder')}
            accessibilityLabel={t('contacts.search.label')}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.search}
          />
        </>
      }
      refreshControl={refreshControl}
      ListEmptyComponent={
        <View style={styles.empty}>
          <QueryState
            pending={contacts.isPending}
            error={contacts.error}
            emptyText={query.trim() ? t('contacts.empty.noMatch', { query: query.trim() }) : t('contacts.empty.title')}
            onRetry={() => void contacts.refetch()}
          />
        </View>
      }
    />
  );
}

function Letter({ letter }: { letter: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.letter, { backgroundColor: theme.page, borderBottomColor: theme.border }]}
      accessibilityRole="header">
      <ThemedText type="label">{letter}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: ColumnWidth },
  loading: { flex: 1 },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  search: { marginHorizontal: Spacing.three, marginVertical: Spacing.two },
  letter: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
    borderBottomWidth: Hairline,
  },
  empty: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignItems: 'center',
  },
});
