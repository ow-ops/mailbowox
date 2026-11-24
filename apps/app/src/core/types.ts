import type {
  Address,
  AddressBook,
  AttachmentInfo,
  Contact,
  ContactDraft,
  ContactSyncResult,
  ContactSyncState,
  ContactTag,
  Draft,
  Flags,
  ListFilter,
  MailboxRef,
  MailboxUids,
  MessageRef,
  SearchQuery,
  AccountConfig as NativeAccountConfig,
  DiscoveredSettings as NativeDiscoveredSettings,
  Mailbox as NativeMailbox,
  MailboxRole as NativeMailboxRole,
  MailItem as NativeMailItem,
  StoredMessage as NativeStoredMessage,
  MessageBody as NativeMessageBody,
  MessageSummary as NativeMessageSummary,
  Security as NativeSecurity,
  ServerConfig as NativeServerConfig,
  TlsFailure as NativeTlsFailure,
} from '@mailbowox/core-native';

// The bindings' types, except where the app keeps strings for enums and numbers for dates because it stores them.
// src/core/index.ts converts those fields.
export type {
  Address,
  AddressBook,
  AttachmentInfo,
  Contact,
  ContactDraft,
  ContactSyncResult,
  ContactSyncState,
  ContactTag,
  ContactValue,
  Draft,
  Flags,
  ListFilter,
  OutgoingAttachment,
  SearchQuery,
} from '@mailbowox/core-native';

type EnumName<E> = Uncapitalize<Extract<keyof E, string>>;

export type Security = EnumName<typeof NativeSecurity>;
export type MailboxRole = EnumName<typeof NativeMailboxRole>;
export type TlsFailure = EnumName<typeof NativeTlsFailure>;
export type DiscoverySource = 'autoconfig' | 'ispdb' | 'provider' | 'srv' | 'mx' | 'probe';

export type ServerConfig = Omit<NativeServerConfig, 'security'> & { security: Security };
export type AccountConfig = Omit<NativeAccountConfig, 'imap' | 'smtp'> & { imap: ServerConfig; smtp: ServerConfig };
export type Mailbox = Omit<NativeMailbox, 'role'> & { role?: MailboxRole };
export type MessageSummary = Omit<NativeMessageSummary, 'date'> & { date: number };
export type MessageBody = NativeMessageBody;
export type MailItem = Omit<NativeMailItem, 'summary'> & { summary: MessageSummary };
type StoredMessage = Omit<NativeStoredMessage, 'summary'> & { summary: MessageSummary };
// `latest` is the newest message in the viewed mailbox, `inView` all of them there, `messages` the whole
// conversation across the account's mailboxes; oldest first.
export type Conversation = { latest: StoredMessage; messages: StoredMessage[]; inView: StoredMessage[] };
export type Cursor = { date: number; account: string; uid: number };
type Oldest = { uid: number; date: number; uidValidity: number };
type SyncOutcome = { reset: boolean; truncated: boolean; arrived: MessageSummary[] };
export type DiscoveredSettings = Omit<NativeDiscoveredSettings, 'imap' | 'smtp' | 'source'> & {
  imap?: ServerConfig;
  smtp?: ServerConfig;
  source: DiscoverySource;
};

export interface MailSession {
  listMailboxes(): Promise<Mailbox[]>;
  createMailbox(name: string): Promise<void>;
  fetchOlder(mailbox: string, uidValidity: number, beforeUid: number, limit: number): Promise<MessageSummary[]>;
  fetchBody(mailbox: string, uidValidity: number, uid: number, allowRemote: boolean): Promise<MessageBody>;
  fetchAttachment(mailbox: string, uidValidity: number, uid: number, attachment: AttachmentInfo): Promise<ArrayBuffer>;
  setFlags(mailbox: string, uidValidity: number, uids: number[], add: Partial<Flags>, remove: Partial<Flags>): Promise<void>;
  moveMessages(mailbox: string, uidValidity: number, uids: number[], destination: string): Promise<MailboxUids | undefined>;
  deleteMessages(mailbox: string, uidValidity: number, uids: number[]): Promise<void>;
  search(mailbox: string, query: string): Promise<MailboxUids>;
  fetchSummaries(mailbox: string, uidValidity: number, uids: number[]): Promise<MessageSummary[]>;
  append(mailbox: string, raw: ArrayBuffer, flags: Partial<Flags>): Promise<number | undefined>;
  waitForChanges(mailbox: string, timeoutSecs: number): Promise<boolean>;
  logout(): Promise<void>;
}

export interface MailStore {
  syncMailbox(session: MailSession, account: string, mailbox: string, limit: number): Promise<SyncOutcome>;
  saveMailboxes(account: string, mailboxes: Mailbox[]): Promise<void>;
  mailboxes(account: string): Promise<Mailbox[]>;
  unreadCounts(account: string): Promise<Map<string, number>>;
  page(boxes: MailboxRef[], before: Cursor | undefined, limit: number, grouped: boolean, filter: ListFilter): Promise<Conversation[]>;
  loadPage(
    boxes: MailboxRef[],
    before: Cursor | undefined,
    limit: number,
    grouped: boolean,
    filter: ListFilter,
    fetchOlder: (before: MessageRef, limit: number) => Promise<MessageSummary[]>,
  ): Promise<Conversation[]>;
  conversation(message: MessageRef, grouped: boolean): Promise<Conversation | undefined>;
  message(message: MessageRef): Promise<StoredMessage | undefined>;
  messages(refs: MessageRef[]): Promise<StoredMessage[]>;
  threadItems(account: string, mailbox: string, uidValidity: number, thread: string): Promise<StoredMessage[]>;
  putMessages(items: MailItem[]): Promise<void>;
  addOlder(account: string, mailbox: string, uidValidity: number, summaries: MessageSummary[]): Promise<void>;
  removeMessages(refs: MessageRef[]): Promise<void>;
  oldest(account: string, mailbox: string): Promise<Oldest | undefined>;
  cachedBody(message: MessageRef, allowRemote: boolean): Promise<MessageBody | undefined>;
  fetchBody(session: MailSession, message: MessageRef, allowRemote: boolean): Promise<MessageBody>;
  blockedCount(message: MessageRef): Promise<number | undefined>;
  seenAddresses(): Promise<Address[]>;
  search(boxes: MailboxRef[], query: SearchQuery, limit: number): Promise<StoredMessage[]>;
  storedAccounts(): Promise<string[]>;
  deleteAccount(account: string): Promise<void>;
}

export interface Core {
  discover(email: string): Promise<DiscoveredSettings | undefined>;
  verifyIncoming(config: AccountConfig): Promise<void>;
  verifyOutgoing(config: AccountConfig): Promise<void>;
  connect(config: AccountConfig): Promise<MailSession>;
  sendMessage(config: AccountConfig, draft: Draft): Promise<ArrayBuffer>;
  buildMessage(draft: Draft): Promise<ArrayBuffer>;
  configureRelay(url: string, token: string): void;
  discoverContacts(config: AccountConfig): Promise<string | undefined>;
  listAddressBooks(config: AccountConfig, home: string): Promise<AddressBook[]>;
  syncContacts(
    config: AccountConfig,
    addressBook: string,
    since: ContactSyncState | undefined,
    known: ContactTag[],
  ): Promise<ContactSyncResult>;
  createContact(config: AccountConfig, addressBook: string, draft: ContactDraft): Promise<Contact>;
  updateContact(config: AccountConfig, contact: Contact, draft: ContactDraft): Promise<Contact>;
  deleteContact(config: AccountConfig, href: string, etag: string | undefined): Promise<void>;
  unsubscribeOneClick(url: string): Promise<void>;
  openStore(path: string): Promise<MailStore>;
  openStoreWith(run: (request: ArrayBuffer) => Promise<ArrayBuffer>, database: string): Promise<MailStore>;
}
