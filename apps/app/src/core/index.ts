import * as native from '@mailbowox/core-native';

import type {
  AccountConfig,
  Core,
  DiscoveredSettings,
  DiscoverySource,
  Flags,
  MailboxRole,
  MailSession,
  MessageSummary,
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

const fromSummary = (summary: native.MessageSummary): MessageSummary => ({ ...summary, date: Number(summary.date) });

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

function wrap(session: native.MailSessionLike): MailSession {
  return explainErrors<MailSession>({
    listMailboxes: async () =>
      (await session.listMailboxes()).map((mailbox) => ({
        ...mailbox,
        role: mailbox.role === undefined ? undefined : fromRole(mailbox.role),
      })),
    createMailbox: (name) => session.createMailbox(name),
    sync: async (mailbox, since, known, limit) => {
      const result = await session.sync(mailbox, since, known, limit);
      return { ...result, changed: result.changed.map(fromSummary) };
    },
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
  listAddressBooks: (config, home) => native.listAddressBooks(toConfig(config), home),
  syncContacts: (config, addressBook, since, known) =>
    native.syncContacts(toConfig(config), addressBook, since, known),
  createContact: (config, addressBook, draft) => native.createContact(toConfig(config), addressBook, draft),
  updateContact: (config, contact, draft) => native.updateContact(toConfig(config), contact, draft),
  deleteContact: (config, href, etag) => native.deleteContact(toConfig(config), href, etag),
});

// On web the core is a WebAssembly module that must load before the first call; natively this resolves at once.
export const loadCore = () => native.uniffiInitAsync();
