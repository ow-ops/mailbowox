import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, useWindowDimensions, View, type TextInput } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { EmptyReader } from '@/components/empty-reader';
import { KeyCap } from '@/components/key-cap';
import {
  DoneButton,
  InlineMailHeader,
  MailActions,
  MailboxTitle,
  SelectAllButton,
  SelectingTitle,
  useViewTitle,
} from '@/components/mail-header';
import { MailboxList } from '@/components/mailbox-list';
import { MessageList } from '@/components/message-list';
import { MessageReader } from '@/components/message-reader';
import { SearchResults } from '@/components/search-results';
import { SelectionBar } from '@/components/selection-bar';
import { TextField } from '@/components/text-field';
import {
  Hairline,
  ListPaneWidth,
  MailboxPaneWidth,
  MinListPaneWidth,
  MinSplitHeight,
  Spacing,
  WindowClass,
} from '@/constants/theme';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useTheme } from '@/hooks/use-theme';
import { useWebSidebar, useWebTopInset } from '@/hooks/use-web-sidebar';
import { messageKey, messageParams, type MessageRef } from '@/mail/refs';
import { useConversations, useRoleMailbox, useSearch, type SearchScope } from '@/mail/queries';
import {
  allSelected,
  conversationKey,
  indexOf,
  replacement,
  selectedConversations,
  setSelected,
  stopSelecting,
  useSelection,
  type Entry,
} from '@/mail/selection';
import { boxesOf, setMailView, useMailView, type MailView } from '@/mail/view';

const web = Platform.OS === 'web';

export function MailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const view = useMailView();
  const title = useViewTitle(view);
  const windowHeight = useWindowDimensions().height;
  const sidebar = useWebSidebar();
  const topInset = useWebTopInset();
  // The window can be wider than the content area (iPad sidebar), so wait for the container.
  const [width, setWidth] = useState<number | null>(null);
  const split = width !== null && (sidebar || width >= WindowClass.expanded) && windowHeight >= MinSplitHeight;
  // The mailbox pane joins once the reader keeps at least a list's width beside it. The web sidebar lists them itself.
  const mailboxPane = split && !sidebar && width >= MailboxPaneWidth + 2 * ListPaneWidth;
  // Beside the sidebar the list grows with the window up to its usual width, and the reader takes the rest.
  const listWidth =
    sidebar && width !== null ? Math.min(ListPaneWidth, Math.max(MinListPaneWidth, width * 0.4)) : ListPaneWidth;
  const [selected, setSelectedMessage] = useState<MessageRef | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('mailbox');
  const searchField = useRef<ComponentRef<typeof TextInput>>(null);
  const searching = query.trim().length > 0;
  const found = useSearch(view, scope, query);

  const selection = useSelection();
  const conversations = useConversations(view).data?.pages.flat() ?? [];
  const checked = selectedConversations(conversations, selection.keys);
  const every = allSelected(conversations, selection.keys);
  const toggleAll = () => setSelected(every ? [] : conversations.map(conversationKey));
  const inArchive = useInArchive(view);

  const [resetKey, setResetKey] = useState({ view, split });
  if (resetKey.view !== view || resetKey.split !== split) {
    setResetKey({ view, split });
    setSelectedMessage(null);
  }
  // Selection ends when the list changes or the screen goes away.
  useEffect(() => stopSelecting, [view, split]);

  // The rows on screen: the search results while searching, the conversations otherwise.
  const entries: Entry[] = searching
    ? (found.results.data ?? []).map((item) => ({ open: item, holds: [item] }))
    : conversations.map((c) => ({ open: c.latest, holds: c.inView }));

  // Where the open message sat, so the row below can take its place once it is archived, moved or deleted.
  const position = useRef(0);
  const at = indexOf(entries, selected);
  useEffect(() => {
    if (at >= 0) position.current = at;
  }, [at]);

  // j and k move through the list: in the split view they open the message, otherwise they mark the one Enter opens.
  const step = (by: number) => {
    if (!entries.length) return;
    setSelectedMessage(entries[Math.min(Math.max(at + by, 0), entries.length - 1)].open);
  };
  const open = () => {
    const target = selected ?? entries[0]?.open;
    if (!target) return;
    if (split) setSelectedMessage(target);
    else
      router.push({
        pathname: '/message',
        params: messageParams(target),
      });
  };
  useShortcuts({
    j: () => step(1),
    k: () => step(-1),
    o: open,
    Enter: open,
    c: () => router.push('/compose'),
    '/': () => searchField.current?.focus(),
    '?': () => router.push('/shortcuts'),
  });

  useEffect(() => {
    if (!web || !selected) return;
    document.querySelector('#message-list [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const search = (text: string) => {
    setQuery(text);
    if (text.trim()) stopSelecting();
  };

  const border = { borderColor: theme.border };
  const searchInput = (
    <View style={!sidebar && styles.search}>
      <TextField
        ref={searchField}
        value={query}
        onChangeText={search}
        placeholder={t('mail.search.placeholder')}
        accessibilityLabel={t('mail.search.label')}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={styles.searchField}
      />
      <View style={styles.searchIcon}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={20} tintColor={theme.muted} />
      </View>
    </View>
  );
  const webHeader = web ? (
    <View style={{ paddingTop: sidebar ? 0 : topInset }}>
      <InlineMailHeader>
        {selection.selecting ? (
          <>
            <SelectAllButton all={every} onPress={toggleAll} />
            <SelectingTitle count={checked.length} />
            <DoneButton />
          </>
        ) : (
          <>
            <MailboxTitle title={title} switcher={!mailboxPane && !sidebar} />
            <MailActions compose={!sidebar} />
          </>
        )}
      </InlineMailHeader>
      {!sidebar && searchInput}
    </View>
  ) : undefined;

  return (
    <>
      <Stack.Screen
        options={
          selection.selecting
            ? {
                title,
                headerTitle: () => <SelectingTitle count={checked.length} />,
                headerLeft: () => <SelectAllButton all={every} onPress={toggleAll} />,
                headerRight: () => <DoneButton />,
              }
            : {
                title,
                headerTitle: () => <MailboxTitle title={title} switcher={!mailboxPane} />,
                headerLeft: undefined,
                headerRight: () => <MailActions />,
              }
        }
      />
      {!web && (
        <Stack.SearchBar
          placeholder={t('mail.search.placeholder')}
          autoCapitalize="none"
          tintColor={theme.primary}
          textColor={theme.heading}
          hintTextColor={theme.muted}
          onChangeText={({ nativeEvent }) => search(nativeEvent.text)}
          onCancelButtonPress={() => setQuery('')}
        />
      )}
      {sidebar && (
        <View style={[styles.topBar, border]}>
          <View style={styles.wideSearch}>
            {searchInput}
            {!query && (
              <View style={styles.searchKey}>
                <KeyCap label="/" />
              </View>
            )}
          </View>
        </View>
      )}
      <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {mailboxPane && (
          <View style={[styles.mailboxes, border]}>
            <MailboxList current={view} onSelect={setMailView} />
          </View>
        )}
        <View nativeID="message-list" style={split ? [styles.list, { width: listWidth }, border] : styles.single}>
          {webHeader}
          {searching ? (
            <SearchResults
              view={view}
              title={title}
              query={query}
              scope={scope}
              onScope={setScope}
              {...found}
              selected={selected}
              onOpen={split ? setSelectedMessage : undefined}
            />
          ) : (
            <MessageList view={view} selected={selected} onOpen={split ? setSelectedMessage : undefined} />
          )}
          {selection.selecting && <SelectionBar selected={checked} inArchive={inArchive} />}
        </View>
        {split && (
          <View style={[styles.reader, { paddingTop: sidebar ? 0 : topInset }]}>
            {selected ? (
              <MessageReader
                key={messageKey(selected)}
                message={selected}
                onClose={() => setSelectedMessage(null)}
                onGone={() => setSelectedMessage(replacement(entries, selected, position.current))}
              />
            ) : (
              <EmptyReader view={view} />
            )}
          </View>
        )}
      </View>
    </>
  );
}

function useInArchive(view: MailView) {
  const archive = useRoleMailbox(boxesOf(view, useAccounts())[0].account, 'archive');
  return view.kind === 'mailbox' && archive === view.mailbox;
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  single: { flex: 1 },
  mailboxes: { width: MailboxPaneWidth, borderRightWidth: Hairline },
  list: { borderRightWidth: Hairline },
  reader: { flex: 1 },
  search: { marginHorizontal: Spacing.three, marginVertical: Spacing.two },
  topBar: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: Hairline,
  },
  wideSearch: { maxWidth: 720 },
  searchField: { paddingLeft: Spacing.three + 20 + Spacing.two },
  searchIcon: {
    position: 'absolute',
    left: Spacing.three,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  searchKey: {
    position: 'absolute',
    right: Spacing.four,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
