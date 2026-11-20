import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { useAccounts, type Account } from '@/accounts/store';
import type { MailboxRole } from '@/core';
import { t } from '@/i18n';
import { useDebounced } from '@/hooks/use-debounced';
import { usePref } from '@/prefs/store';
import { isOnline } from '@/utils/network';

import { getBlockedCount, getBody, getMailboxes, getMessage, getMessages, getThreadItems, getSeenAddresses, getThreads, getUnreadCounts, pageConversations, pageMessages, putMessages, saveBody, searchMessages, type Cursor } from './db';
import type { MailboxGeneration, MailboxRef, MessageRef, StoredItem } from './refs';
import { loadPage } from './paging';
import { queryClient } from '@/utils/query-client';
import { withSession } from './session';
import { PAGE_SIZE } from './sync';
import { isEmptyQuery, parseQuery, rankResults } from './search';
import { conversation, single, type Conversation } from './threads';
import { boxesOf, type MailView } from './view';

const fetchOlder = (before: MessageRef) =>
  withSession(before.account, (s) => s.fetchOlder(before.mailbox, before.uidValidity, before.uid, PAGE_SIZE));

const HIDDEN_ROLES: (MailboxRole | undefined)[] = ['trash', 'junk'];

async function hiddenMailboxes(account: string) {
  return (await getMailboxes(account)).filter((m) => HIDDEN_ROLES.includes(m.role)).map((m) => m.name);
}

async function withConversations(latest: StoredItem[]) {
  const members = await getThreads(latest);
  const accounts = [...new Set(latest.map((item) => item.account))];
  const hidden = new Map(await Promise.all(accounts.map(async (a) => [a, await hiddenMailboxes(a)] as const)));
  return latest.map((item) =>
    conversation(
      item,
      members.filter((m) => m.account === item.account && m.thread === item.thread),
      hidden.get(item.account) ?? [],
    ),
  );
}

export function useConversations(view: MailView) {
  const boxes = boxesOf(view, useAccounts());
  const grouped = usePref('conversations');
  return useInfiniteQuery({
    queryKey: ['messages', view.kind, boxes, grouped],
    initialPageParam: undefined as Cursor | undefined,
    queryFn: async ({ pageParam }) => {
      const page = grouped ? pageConversations : pageMessages;
      // Unread lists what is cached: paging the server for it could walk every inbox to its first message.
      // Offline, the list ends where the cache does.
      const items =
        view.kind === 'unread' || !isOnline()
          ? await page(boxes, pageParam, PAGE_SIZE, view.kind === 'unread')
          : await loadPage(boxes, pageParam, page, PAGE_SIZE, fetchOlder);
      return grouped ? withConversations(items) : items.map(single);
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
  queryFn: async () => ({ mailboxes: await getMailboxes(accountId), unread: await getUnreadCounts(accountId) }),
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

export const useSeenAddresses = () => useQuery({ queryKey: ['addresses'], queryFn: getSeenAddresses });

export function useRoleMailbox(accountId: string, role: MailboxRole) {
  return useMailboxes(accountId).data?.mailboxes.find((m) => m.role === role)?.name;
}

export function useMessage(ref: MessageRef) {
  return useQuery({ queryKey: ['message', ref], queryFn: () => getMessage(ref) });
}

// Null once the message has left its mailbox.
export function useConversation(ref: MessageRef) {
  const grouped = usePref('conversations');
  return useQuery({
    queryKey: ['message', ref, grouped],
    queryFn: async () => {
      const item = await getMessage(ref);
      if (!item) return null;
      return grouped ? (await withConversations([item]))[0] : single(item);
    },
  });
}

// What the move screen moves: one message, or a conversation's messages in the mailbox it was listed in.
export function useMoveItems(box: MailboxGeneration, target: { uid: number } | { thread: string } | null) {
  return useQuery({
    queryKey: ['message', box, target],
    enabled: target !== null,
    queryFn: async () => {
      if (!target) return [];
      if ('thread' in target) return getThreadItems(box, target.thread);
      const item = await getMessage({ ...box, uid: target.uid });
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
      const cached = await getBody(ref, allowRemote);
      if (cached) return cached;
      if (!isOnline()) throw new Error(t('mail.reader.offline'));
      const body = await withSession(ref.account, (s) => s.fetchBody(ref.mailbox, ref.uidValidity, ref.uid, allowRemote));
      await saveBody(ref, body, allowRemote);
      queryClient.invalidateQueries({ queryKey: ['blocked', ref] });
      return body;
    },
  });
}

// How many remote loads the reader blocked in this message, for a quiet marker in the list.
export function useBlockedCount(ref: MessageRef) {
  return useQuery({ queryKey: ['blocked', ref], queryFn: () => getBlockedCount(ref) });
}

export type SearchScope = 'mailbox' | 'all';

const LOCAL_RESULTS = 200;
const SERVER_RESULTS = 50;
const SERVER_DELAY = 600;

// Every mailbox searches all of each account's mailboxes but Trash and Junk, as conversations leave them out.
async function searchBoxes(view: MailView, scope: SearchScope, accounts: Account[]) {
  if (scope === 'mailbox') return boxesOf(view, accounts);
  const lists = await Promise.all(
    accounts.map(async ({ id }) =>
      (await getMailboxes(id))
        .filter((m) => m.selectable && !HIDDEN_ROLES.includes(m.role))
        .map((m) => ({ account: id, mailbox: m.name })),
    ),
  );
  return lists.flat();
}

// The newest server matches per mailbox, with the summaries of those not cached fetched and stored.
async function searchServer(boxes: MailboxRef[], query: string) {
  const accounts = [...new Set(boxes.map((box) => box.account))];
  const found = await Promise.all(
    accounts.map((account) =>
      withSession(account, async (session) => {
        const refs: MessageRef[] = [];
        for (const box of boxes.filter((b) => b.account === account)) {
          const { uidValidity, uids } = await session.search(box.mailbox, query);
          const generation = { ...box, uidValidity };
          const matches = uids.slice(0, SERVER_RESULTS).map((uid) => ({ ...generation, uid }));
          const cached = new Set((await getMessages(matches)).map((item) => item.uid));
          const missing = matches.map(({ uid }) => uid).filter((uid) => !cached.has(uid));
          if (missing.length) {
            const summaries = await session.fetchSummaries(box.mailbox, uidValidity, missing);
            await putMessages(summaries.map((summary) => ({ ...generation, uid: summary.uid, summary })));
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
      const local = await searchMessages(await searchBoxes(view, scope, accounts), parsed, LOCAL_RESULTS);
      return rankResults([...local, ...(await getMessages(found ?? []))], parsed);
    },
    enabled: !isEmptyQuery(parsed),
    placeholderData: keepPreviousData,
  });
  return { results, server: { pending: settled !== text || server.isFetching, error: server.error, retry: server.refetch } };
}
