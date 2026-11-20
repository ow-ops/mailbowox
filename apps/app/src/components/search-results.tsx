import { FlashList } from '@shopify/flash-list';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { Button } from '@/components/button';
import { ErrorExplanation } from '@/components/error-explanation';
import { MessageRow } from '@/components/message-row';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { Hairline, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { messageKey, sameMessage, type MessageRef, type StoredItem } from '@/mail/refs';
import { explainError } from '@/core/errors';
import { mailboxLabel } from '@/mail/mailboxes';
import { mailboxesQuery, type SearchScope, type useSearch } from '@/mail/queries';
import { single } from '@/mail/threads';
import type { MailView } from '@/mail/view';

// The results come from the screen, which also moves through them with the keyboard.
type Props = ReturnType<typeof useSearch> & {
  view: MailView;
  title: string;
  query: string;
  scope: SearchScope;
  onScope: (scope: SearchScope) => void;
  selected: MessageRef | null;
  onOpen?: (item: StoredItem) => void;
};

export function SearchResults({ view, title, query, scope, onScope, results, server, selected, onOpen }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const accounts = useAccounts();
  const items = results.data ?? [];
  const mailboxes = useQueries({ queries: accounts.map((a) => mailboxesQuery(a.id)) });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const mixed = accounts.length > 1 && (scope === 'all' || view.kind !== 'mailbox');

  const mailboxName = (item: StoredItem) => {
    const list = mailboxes[accounts.findIndex((a) => a.id === item.account)]?.data?.mailboxes;
    const mailbox = list?.find((m) => m.name === item.mailbox);
    return mailbox ? mailboxLabel(mailbox) : item.mailbox;
  };

  return (
    <FlashList
      data={items}
      keyExtractor={messageKey}
      renderItem={({ item }) => (
        <MessageRow
          conversation={single(item)}
          byRecipient={false}
          self={byId.get(item.account)?.email ?? ''}
          place={scope === 'all' ? mailboxName(item) : undefined}
          account={mixed ? byId.get(item.account) : undefined}
          selected={!!selected && sameMessage(selected, item)}
          selecting={false}
          checked={false}
          onOpen={onOpen}
        />
      )}
      extraData={selected}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: theme.page }}
      ListHeaderComponent={
        <View style={[styles.scope, { borderBottomColor: theme.border }]}>
          <SegmentedControl
            label={t('mail.search.scope')}
            options={[
              { value: 'mailbox', label: title },
              { value: 'all', label: t('mail.search.everywhere') },
            ]}
            value={scope}
            onChange={onScope}
          />
        </View>
      }
      ListEmptyComponent={
        results.isPending || server.pending ? null : (
          <View style={styles.empty}>
            <ThemedText themeColor="muted" style={styles.centered}>
              {t('mail.search.nothing', { query: query.trim() })}
            </ThemedText>
            <ThemedText type="meta" style={styles.centered}>
              {t('mail.search.operators')}
            </ThemedText>
          </View>
        )
      }
      ListFooterComponent={
        server.pending ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.muted} />
            <ThemedText type="meta">{t('mail.search.server')}</ThemedText>
          </View>
        ) : server.error ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <View style={styles.grow}>
              <ThemedText type="label" themeColor="danger">
                {t('mail.search.serverFailed')}
              </ThemedText>
              <ErrorExplanation {...explainError(server.error)} />
            </View>
            <Button label={t('common.retry')} variant="outline" size="small" onPress={() => void server.retry()} />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  scope: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: Hairline,
  },
  empty: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.two,
  },
  centered: { textAlign: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
  },
  grow: {
    flex: 1,
    gap: Spacing.half,
  },
});
