import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { useAccounts, type Account } from '@/accounts/store';
import { t } from '@/i18n';
import { useDebounced } from '@/hooks/use-debounced';
import { usePref } from '@/prefs/store';
import { isOnline } from '@/utils/network';

import type { Cursor, MailboxRole } from '@/core';
import { queryClient } from '@/utils/query-client';

import { isFiltered, listFilter, useFilters } from './filters';
import type { Conversation, MailboxGeneration, MailboxRef, MessageRef } from './refs';
import { isEmptyQuery, parseQuery, rankResults, storeQuery } from './search';
import { withSession } from './session';
import { mailStore } from './store';
import { PAGE_SIZE } from './sync';
import { boxesOf, type MailView } from './view';

const fetchOlder = (before: MessageRef, limit: number) =>
  withSession(before.account, (s) => s.fetchOlder(before.mailbox, before.uidValidity, before.uid, limit));

const HIDDEN_ROLES: (MailboxRole | undefined)[] = ['trash', 'junk'];

export function useConversations(view: MailView) {
  const accounts = useAccounts();
  const boxes = boxesOf(view, accounts);
  const grouped = usePref('conversations');
  const on = useFilters();
  const filter = listFilter({ ...on, unread: on.unread || view.kind === 'unread' }, accounts);
  return useInfiniteQuery({
    queryKey: ['messages', view.kind, boxes, grouped, filter],
    initialPageParam: undefined as Cursor | undefined,
    queryFn: async ({ pageParam }) => {
      const store = await mailStore();
      // A filtered list shows what is cached: paging the server for a few matches could walk every mailbox to
      // its first message. Offline, the list ends where the cache does.
      if (isFiltered(filter) || !isOnline()) return store.page(boxes, pageParam, PAGE_SIZE, grouped, filter);
      return store.loadPage(boxes, pageParam, PAGE_SIZE, grouped, filter, fetchOlder);
    },
    // A short page is not the end: conversations fold several messages into a row, and the cache may stop
    // above mail the server still has. The list ends with the page that comes back empty.
    getNextPageParam: (last: Conversation[]): Cursor | undefined => {
      const item = last.at(-1)?.latest;
      return item && { date: item.summary.date, account: item.account, uid: item.uid };
    },
  });
}

export const mailboxesQuery = (accountId: string) => ({
  queryKey: ['mailboxes', accountId],
  queryFn: async () => {
    const store = await mailStore();
    return { mailboxes: await store.mailboxes(accountId), unread: Object.fromEntries(await store.unreadCounts(accountId)) };
  },
});

export function useMailboxes(accountId: string) {
  return useQuery(mailboxesQuery(accountId));
}

export function useUnreadCount(view: MailView) {
  const boxes = boxesOf(view, useAccounts());
  return useQueries({
    queries: boxes.map((box) => mailboxesQuery(box.account)),
    combine: (results) => results.reduce((sum, { data }, i) => sum + (data?.unread[boxes[i].mailbox] ?? 0), 0),
  });
}

export const useSeenAddresses = () =>
  useQuery({ queryKey: ['addresses'], queryFn: async () => (await mailStore()).seenAddresses() });

export function useRoleMailbox(accountId: string, role: MailboxRole) {
  return useMailboxes(accountId).data?.mailboxes.find((m) => m.role === role)?.name;
}

export function useMessage(ref: MessageRef) {
  return useQuery({ queryKey: ['message', ref], queryFn: async () => (await (await mailStore()).message(ref)) ?? null });
}

// Null once the message has left its mailbox.
export function useConversation(ref: MessageRef) {
  const grouped = usePref('conversations');
  return useQuery({
    queryKey: ['message', ref, grouped],
    queryFn: async () => (await (await mailStore()).conversation(ref, grouped)) ?? null,
  });
}

// What the move screen moves: one message, or a conversation's messages in the mailbox it was listed in.
export function useMoveItems(box: MailboxGeneration, target: { uid: number } | { thread: string } | null) {
  return useQuery({
    queryKey: ['message', box, target],
    enabled: target !== null,
    queryFn: async () => {
      const store = await mailStore();
      if (!target) return [];
      if ('thread' in target) return store.threadItems(box.account, box.mailbox, box.uidValidity, target.thread);
      const item = await store.message({ ...box, uid: target.uid });
      return item ? [item] : [];
    },
  });
}

export function useBody(ref: MessageRef, allowRemote: boolean) {
  return useQuery({
    queryKey: ['body', ref, allowRemote],
    staleTime: Infinity,
    refetchOnReconnect: true,
    queryFn: async () => {
      const store = await mailStore();
      const cached = await store.cachedBody(ref, allowRemote);
      if (cached) return cached;
      if (!isOnline()) throw new Error(t('mail.reader.offline'));
      const body = await withSession(ref.account, (s) => store.fetchBody(s, ref, allowRemote));
      queryClient.invalidateQueries({ queryKey: ['blocked', ref] });
      return body;
    },
  });
}

// How many remote loads the reader blocked in this message, for a quiet marker in the list.
export function useBlockedCount(ref: MessageRef) {
  return useQuery({ queryKey: ['blocked', ref], queryFn: async () => (await (await mailStore()).blockedCount(ref)) ?? null });
}

export type SearchScope = 'mailbox' | 'all';

const LOCAL_RESULTS = 200;
const SERVER_RESULTS = 50;
const SERVER_DELAY = 600;

// Every mailbox searches all of each account's mailboxes but Trash and Junk, as conversations leave them out.
async function searchBoxes(view: MailView, scope: SearchScope, accounts: Account[]) {
  if (scope === 'mailbox') return boxesOf(view, accounts);
  const store = await mailStore();
  const lists = await Promise.all(
    accounts.map(async ({ id }) =>
      (await store.mailboxes(id))
        .filter((m) => m.selectable && !HIDDEN_ROLES.includes(m.role))
        .map((m) => ({ account: id, mailbox: m.name })),
    ),
  );
  return lists.flat();
}

// The newest server matches per mailbox, with the summaries of those not cached fetched and stored.
async function searchServer(boxes: MailboxRef[], query: string) {
  const store = await mailStore();
  const accounts = [...new Set(boxes.map((box) => box.account))];
  const found = await Promise.all(
    accounts.map((account) =>
      withSession(account, async (session) => {
        const refs: MessageRef[] = [];
        for (const box of boxes.filter((b) => b.account === account)) {
          const { uidValidity, uids } = await session.search(box.mailbox, query);
          const generation = { ...box, uidValidity };
          const matches = uids.slice(0, SERVER_RESULTS).map((uid) => ({ ...generation, uid }));
          const cached = new Set((await store.messages(matches)).map((item) => item.uid));
          const missing = matches.map(({ uid }) => uid).filter((uid) => !cached.has(uid));
          if (missing.length) {
            const summaries = await session.fetchSummaries(box.mailbox, uidValidity, missing);
            await store.putMessages(summaries.map((summary) => ({ ...generation, summary })));
          }
          refs.push(...matches);
        }
        return refs;
      }),
    ),
  );
  return found.flat();
}

// The cache answers as you type; the server is asked once typing pauses, for older mail and body text.
export function useSearch(view: MailView, scope: SearchScope, query: string) {
  const accounts = useAccounts();
  const text = query.trim();
  const parsed = parseQuery(text);
  const settled = useDebounced(text, SERVER_DELAY);
  const asked = parseQuery(settled).server;
  const key = [view, scope, accounts.map((a) => a.id)];
  const server = useQuery({
    queryKey: ['server-search', ...key, asked],
    queryFn: async () => searchServer(await searchBoxes(view, scope, accounts), asked),
    enabled: asked.length > 0,
    staleTime: 5 * 60_000,
    networkMode: 'online',
    retry: false,
  });
  const found = settled === text ? server.data : undefined;
  const results = useQuery({
    queryKey: ['search', ...key, text, found],
    queryFn: async () => {
      const store = await mailStore();
      const local = await store.search(await searchBoxes(view, scope, accounts), storeQuery(parsed), LOCAL_RESULTS);
      return rankResults([...local, ...(await store.messages(found ?? []))], parsed);
    },
    enabled: !isEmptyQuery(parsed),
    placeholderData: keepPreviousData,
  });
  return { results, server: { pending: settled !== text || server.isFetching, error: server.error, retry: server.refetch } };
}
