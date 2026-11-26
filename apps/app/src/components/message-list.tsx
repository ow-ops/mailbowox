import { FlashList } from '@shopify/flash-list';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { Button } from '@/components/button';
import { ErrorExplanation } from '@/components/error-explanation';
import { ListFilters } from '@/components/list-filters';
import { OfflineBanner } from '@/components/offline-banner';
import { OutboxBanners } from '@/components/outbox-banners';
import { MessageRow } from '@/components/message-row';
import { QueryState } from '@/components/query-state';
import { SyncFailureBanners, useSyncRefresh } from '@/components/sync-status';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { sameMessage, type MessageRef, type StoredItem , Conversation } from '@/mail/refs';
import { explainError } from '@/core/errors';
import { useConversations, useMailboxes } from '@/mail/queries';
import { hasCategories, isFiltered, shownBoxes, useFilters, useHiddenAccounts } from '@/mail/filters';
import { conversationKey, useSelection } from '@/mail/selection';
import { retrySync, syncMailbox, useSyncErrors } from '@/mail/sync';
import type { MailView } from '@/mail/view';
import { usePref } from '@/prefs/store';
import { isOnline, useOnline } from '@/utils/network';
import { settleAll } from '@/utils/settle';

type Props = {
  view: MailView;
  selected: MessageRef | null;
  onOpen?: (item: StoredItem) => void;
};

// The selection can be an older message of the conversation once a newer one has arrived.
const isSelected = ({ inView }: Conversation, selected: MessageRef | null) =>
  !!selected && inView.some((item) => sameMessage(item, selected));

export function MessageList({ view, selected, onOpen }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const accounts = useAccounts();
  const query = useConversations(view);
  const conversations = query.data?.pages.flat() ?? [];
  const selection = useSelection();
  const filtered = isFiltered(useFilters());
  const categories = usePref('inboxCategories') && hasCategories(view);
  // The same object while neither changes, so the rows are not all rendered again with the list.
  const extraData = useMemo(() => ({ selected, selection }), [selected, selection]);
  const boxes = shownBoxes(view, accounts, useHiddenAccounts());
  const role = useMailboxes(boxes[0].account).data?.mailboxes.find((m) => m.name === boxes[0].mailbox)?.role;
  const byRecipient = view.kind === 'mailbox' && (role === 'sent' || role === 'drafts');
  const mixed = view.kind !== 'mailbox';
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const errors = useSyncErrors();
  const failing = Object.fromEntries(boxes.flatMap(({ account }) => (errors[account] ? [[account, errors[account]]] : [])));
  // With nothing to list, the empty state explains the failure instead of the banners.
  const notSynced = conversations.length === 0 && !query.isPending && !query.error && Object.keys(failing).length > 0;

  const refreshControl = useSyncRefresh(async () => {
    if (isOnline()) await settleAll(boxes.map(syncMailbox));
  }, t('mail.list.refreshFailed'));

  return (
    <FlashList
      data={conversations}
      keyExtractor={conversationKey}
      renderItem={({ item }) => (
        <MessageRow
          conversation={item}
          byRecipient={byRecipient}
          self={byId.get(item.latest.account)?.email ?? ''}
          account={mixed ? byId.get(item.latest.account) : undefined}
          selected={isSelected(item, selected)}
          selecting={selection.selecting}
          checked={selection.keys.has(conversationKey(item))}
          onOpen={onOpen}
        />
      )}
      extraData={extraData}
      contentInsetAdjustmentBehavior="automatic"
      // A filter swaps the data; keeping a row in place scrolled the list off the top.
      maintainVisibleContentPosition={{ disabled: true }}
      style={{ backgroundColor: theme.page }}
      ListHeaderComponent={
        <>
          <OfflineBanner />
          <ListFilters view={view} categories={categories} />
          <OutboxBanners accounts={boxes.map((box) => box.account)} />
          {!notSynced && (
            <SyncFailureBanners errors={failing} title={(email) => t('mail.list.syncFailed', { email })} />
          )}
        </>
      }
      refreshControl={refreshControl}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <View style={styles.empty}>
          {notSynced ? (
            <NotSynced failing={failing} />
          ) : (
            <QueryState
              pending={query.isPending}
              error={query.error}
              emptyText={filtered ? t('mail.filters.empty') : t('mail.list.empty')}
              onRetry={() => void query.refetch()}
            />
          )}
        </View>
      }
      ListFooterComponent={
        query.isFetchingNextPage || query.isFetchNextPageError ? (
          <View style={styles.footer}>
            <QueryState
              pending={query.isFetchingNextPage}
              error={query.error}
              onRetry={() => void query.fetchNextPage()}
            />
          </View>
        ) : null
      }
    />
  );
}

function NotSynced({ failing }: { failing: Record<string, unknown> }) {
  const { t } = useTranslation();
  const accounts = useAccounts().filter((account) => failing[account.id]);
  const online = useOnline();
  const retry = useMutation({ mutationFn: () => retrySync(Object.keys(failing)) });

  return (
    <View style={styles.notSynced} accessibilityLiveRegion="polite">
      <ThemedText type="name" accessibilityRole="header">
        {t('mail.list.notSynced')}
      </ThemedText>
      {accounts.map((account) => (
        <View key={account.id} style={styles.failure}>
          <ThemedText type="labelSmall" themeColor="danger" style={styles.center}>
            {t('mail.list.syncFailed', { email: account.email })}
          </ThemedText>
          <ErrorExplanation {...explainError(failing[account.id])} centered />
        </View>
      ))}
      <Button
        label={t('mail.list.syncAgain')}
        variant="outline"
        size="small"
        loading={retry.isPending}
        disabled={!online}
        onPress={() => retry.mutate()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notSynced: { alignItems: 'center', gap: Spacing.three, maxWidth: 420 },
  failure: { alignItems: 'center', gap: Spacing.one },
  center: { textAlign: 'center' },
  empty: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignItems: 'center',
  },
  footer: {
    padding: Spacing.four,
  },
});
