import * as native from '@mailbowox/core-native';

import type {
  AccountConfig,
  Category,
  ListFilter,
  Core,
  DiscoveredSettings,
  DiscoverySource,
  Flags,
  Mailbox,
  MailboxRole,
  MailItem,
  MailSession,
  MailStore,
  MessageSummary,
  QueuedMessage,
  Security,
  ServerConfig,
  TlsFailure,
} from './types';

export type * from './types';

// The bindings use numeric enums and bigint dates; the app stores these values, so it keeps strings and numbers.
const capitalize = <T extends string>(name: T) => (name.charAt(0).toUpperCase() + name.slice(1)) as Capitalize<T>;
const uncapitalize = <T extends string>(name: T) => (name.charAt(0).toLowerCase() + name.slice(1)) as Uncapitalize<T>;

const toSecurity = (security: Security) => native.Security[capitalize(security)];
const fromSecurity = (security: native.Security) => uncapitalize(native.Security[security]) as Security;
const fromRole = (role: native.MailboxRole) => uncapitalize(native.MailboxRole[role]) as MailboxRole;
const fromTlsFailure = (reason: native.TlsFailure) => uncapitalize(native.TlsFailure[reason]) as TlsFailure;

const noFlags: Flags = { seen: false, flagged: false, answered: false, draft: false, deleted: false };

const toServer = (server: ServerConfig): native.ServerConfig => ({ ...server, security: toSecurity(server.security) });
const fromServer = (server: native.ServerConfig): ServerConfig => ({ ...server, security: fromSecurity(server.security) });

const toConfig = (config: AccountConfig): native.AccountConfig => ({
  ...config,
  imap: toServer(config.imap),
  smtp: toServer(config.smtp),
});

const toCategory = (category: Category) => native.Category[capitalize(category)];
const fromCategory = (category: native.Category) => uncapitalize(native.Category[category]) as Category;

const fromSummary = (summary: native.MessageSummary): MessageSummary => ({
  ...summary,
  date: Number(summary.date),
  category: fromCategory(summary.category),
});
const toSummary = (summary: MessageSummary): native.MessageSummary => ({
  ...summary,
  date: BigInt(summary.date),
  category: toCategory(summary.category),
});
const toFilter = (filter: ListFilter): native.ListFilter => ({
  ...filter,
  since: filter.since === undefined ? undefined : BigInt(filter.since),
  category: filter.category === undefined ? undefined : toCategory(filter.category),
});
const fromStored = (message: native.StoredMessage) => ({ ...message, summary: fromSummary(message.summary) });
const fromConversation = (c: native.Conversation) => ({
  latest: fromStored(c.latest),
  messages: c.messages.map(fromStored),
  inView: c.inView.map(fromStored),
});
const fromMailbox = (mailbox: native.Mailbox) => ({
  ...mailbox,
  role: mailbox.role === undefined ? undefined : fromRole(mailbox.role),
});
const toMailbox = (mailbox: Mailbox): native.Mailbox => ({
  ...mailbox,
  role: mailbox.role === undefined ? undefined : native.MailboxRole[capitalize(mailbox.role)],
});

function fromDiscovered(found: native.DiscoveredSettings | undefined): DiscoveredSettings | undefined {
  return (
    found && {
      ...found,
      imap: found.imap && fromServer(found.imap),
      smtp: found.smtp && fromServer(found.smtp),
      source: found.source as DiscoverySource,
    }
  );
}

// UniFFI errors carry only the variant name in `message`; the core's own explanation is in `inner.message`.
// Moving it to `message` here means every screen that shows an error shows that explanation. A TLS failure
// also says why, as `reason`.
function explained(error: unknown) {
  const inner = (error as { inner?: { message?: unknown; reason?: native.TlsFailure } } | null)?.inner;
  if (!(error instanceof Error) || !inner) return error;
  if (typeof inner.message === 'string' && inner.message !== '') error.message = inner.message;
  if (inner.reason !== undefined) Object.assign(error, { reason: fromTlsFailure(inner.reason) });
  return error;
}

function explainErrors<T extends object>(calls: T): T {
  return Object.fromEntries(
    Object.entries(calls).map(([name, call]) => [
      name,
      (...args: unknown[]) => {
        try {
          const result = (call as (...args: unknown[]) => unknown)(...args);
          return result instanceof Promise
            ? result.catch((error: unknown) => {
                throw explained(error);
              })
            : result;
        } catch (error) {
          throw explained(error);
        }
      },
    ]),
  ) as T;
}

// The store takes the session the core made, not the app's wrapper around it.
const natives = new WeakMap<MailSession, native.MailSessionLike>();

const nativeOf = (session: MailSession) => {
  const found = natives.get(session);
  if (!found) throw new Error('not a session the core opened');
  return found;
};

function wrap(session: native.MailSessionLike): MailSession {
  const wrapped = explainErrors<MailSession>({
    listMailboxes: async () => (await session.listMailboxes()).map(fromMailbox),
    createMailbox: (name) => session.createMailbox(name),
    fetchOlder: async (mailbox, uidValidity, beforeUid, limit) =>
      (await session.fetchOlder(mailbox, uidValidity, beforeUid, limit)).map(fromSummary),
    fetchBody: (mailbox, uidValidity, uid, allowRemote) => session.fetchBody(mailbox, uidValidity, uid, allowRemote),
    fetchAttachment: (mailbox, uidValidity, uid, attachment) => session.fetchAttachment(mailbox, uidValidity, uid, attachment),
    setFlags: (mailbox, uidValidity, uids, add, remove) =>
      session.setFlags(mailbox, uidValidity, uids, { ...noFlags, ...add }, { ...noFlags, ...remove }),
    moveMessages: (mailbox, uidValidity, uids, destination) => session.moveMessages(mailbox, uidValidity, uids, destination),
    deleteMessages: (mailbox, uidValidity, uids) => session.deleteMessages(mailbox, uidValidity, uids),
    search: (mailbox, query) => session.search(mailbox, query),
    fetchSummaries: async (mailbox, uidValidity, uids) => (await session.fetchSummaries(mailbox, uidValidity, uids)).map(fromSummary),
    append: (mailbox, raw, flags) => session.append(mailbox, raw, { ...noFlags, ...flags }),
    waitForChanges: (mailbox, timeoutSecs) => session.waitForChanges(mailbox, timeoutSecs),
    logout: () => session.logout(),
  });
  natives.set(wrapped, session);
  return wrapped;
}

const fromQueued = (queued: native.QueuedMessage): QueuedMessage => ({
  ...queued,
  id: Number(queued.id),
  queuedAt: Number(queued.queuedAt),
  error: queued.error ?? null,
});

function wrapStore(store: native.MailStoreLike): MailStore {
  return explainErrors<MailStore>({
    syncMailbox: async (session, account, mailbox, limit) => {
      const outcome = await store.syncMailbox(nativeOf(session), account, mailbox, limit);
      return { ...outcome, arrived: outcome.arrived.map(fromSummary) };
    },
    saveMailboxes: (account, mailboxes) => store.saveMailboxes(account, mailboxes.map(toMailbox)),
    mailboxes: async (account) => (await store.mailboxes(account)).map(fromMailbox),
    unreadCounts: (account) => store.unreadCounts(account),
    page: async (boxes, before, limit, grouped, filter) =>
      (await store.page(boxes, before && { ...before, date: BigInt(before.date) }, limit, grouped, toFilter(filter))).map(
        fromConversation,
      ),
    loadPage: async (boxes, before, limit, grouped, filter, fetchOlder) => {
      const older = { fetchOlder: async (from: native.MessageRef, count: number) => (await fetchOlder(from, count)).map(toSummary) };
      const page = await store.loadPage(boxes, before && { ...before, date: BigInt(before.date) }, limit, grouped, toFilter(filter), older);
      return page.map(fromConversation);
    },
    conversation: async (message, grouped) => {
      const found = await store.conversation(message, grouped);
      return found && fromConversation(found);
    },
    message: async (message) => {
      const found = await store.message(message);
      return found && fromStored(found);
    },
    messages: async (refs) => (await store.messages(refs)).map(fromStored),
    threadItems: async (account, mailbox, uidValidity, thread) =>
      (await store.threadItems(account, mailbox, uidValidity, thread)).map(fromStored),
    putMessages: (items: MailItem[]) => store.putMessages(items.map((item) => ({ ...item, summary: toSummary(item.summary) }))),
    addOlder: (account, mailbox, uidValidity, summaries) =>
      store.addOlder(account, mailbox, uidValidity, summaries.map(toSummary)),
    removeMessages: (refs) => store.removeMessages(refs),
    oldest: async (account, mailbox) => {
      const found = await store.oldest(account, mailbox);
      return found && { ...found, date: Number(found.date) };
    },
    cachedBody: (message, allowRemote) => store.cachedBody(message, allowRemote),
    fetchBody: (session, message, allowRemote) => store.fetchBody(nativeOf(session), message, allowRemote),
    blockedCount: (message) => store.blockedCount(message),
    seenAddresses: () => store.seenAddresses(),
    search: async (boxes, query, limit) => (await store.search(boxes, query, limit)).map(fromStored),
    storedAccounts: () => store.storedAccounts(),
    deleteAccount: (account) => store.deleteAccount(account),
    syncContacts: (config, account, home) => store.syncContacts(toConfig(config), account, home),
    addressBooks: async () => (await store.addressBooks()).map(({ account, book }) => ({ ...book, account })),
    putContact: (account, book, contact) => store.putContact(account, book, contact),
    removeContact: (account, href) => store.removeContact(account, href),
    contacts: (words) => store.contacts(words),
    contactAddresses: () => store.contactAddresses(),
    contact: (account, href) => store.contact(account, href),
    enqueue: async (account, draft, error) => Number(await store.enqueue(account, draft, error ?? undefined)),
    queuedMessages: async () => (await store.queuedMessages()).map(fromQueued),
    queuedMessage: async (id) => {
      const found = await store.queuedMessage(BigInt(id));
      return found && fromQueued(found);
    },
    queuedAttachments: (id) => store.queuedAttachments(BigInt(id)),
    removeQueued: (id) => store.removeQueued(BigInt(id)),
    setQueuedError: (id, error) => store.setQueuedError(BigInt(id), error ?? undefined),
    setDraftAttachments: (slot, attachments) =>
      store.setDraftAttachments(slot, attachments.map((a) => ({ ...a, size: BigInt(a.size) }))),
    setOwnAddresses: (account, emails) => store.setOwnAddresses(account, emails),
    avatar: async (email) => {
      const found = await store.avatar(email);
      return found && { source: found.source, checkedAt: Number(found.checkedAt) };
    },
    setAvatar: (email, source) => store.setAvatar(email, source),
    moveSender: (account, email, category) => store.moveSender(account, email, toCategory(category)),
    draftAttachments: async (slot) =>
      (await store.draftAttachments(slot)).map((a) => ({ ...a, size: Number(a.size) })),
  });
}

export const core = explainErrors<Core>({
  discover: async (email) => fromDiscovered(await native.discover(email)),
  verifyIncoming: (config) => native.verifyIncoming(toConfig(config)),
  verifyOutgoing: (config) => native.verifyOutgoing(toConfig(config)),
  connect: async (config) => wrap(await native.MailSession.connect(toConfig(config))),
  sendMessage: (config, draft) => native.sendMessage(toConfig(config), draft),
  buildMessage: async (draft) => native.buildMessage(draft),
  configureRelay: (url, token) => native.configureRelay(url, token),
  discoverContacts: (config) => native.discoverContacts(toConfig(config)),
  createContact: (config, addressBook, draft) => native.createContact(toConfig(config), addressBook, draft),
  updateContact: (config, contact, draft) => native.updateContact(toConfig(config), contact, draft),
  deleteContact: (config, href, etag) => native.deleteContact(toConfig(config), href, etag),
  unsubscribeOneClick: (url) => native.unsubscribeOneClick(url),
  openStore: async (path) => wrapStore(await native.MailStore.open(path)),
  openStoreWith: async (run, database) => wrapStore(await native.MailStore.openWith({ run: (request) => run(request) }, database)),
});

// On web the core is a WebAssembly module that must load before the first call; natively this resolves at once.
export const loadCore = () => native.uniffiInitAsync();
