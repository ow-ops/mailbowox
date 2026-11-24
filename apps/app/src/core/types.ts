import type {
  Address,
  AddressBook,
  AttachmentInfo,
  Contact,
  ContactAddress,
  ContactRow,
  StoredContact,
  ContactDraft,
  Draft,
  Flags,
  MailboxRef,
  OutgoingAttachment,
  MailboxUids,
  MessageRef,
  SearchQuery,
  AccountConfig as NativeAccountConfig,
  DiscoveredSettings as NativeDiscoveredSettings,
  Mailbox as NativeMailbox,
  Category as NativeCategory,
  ListFilter as NativeListFilter,
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
  AttachmentInfo,
  Contact,
  ContactDraft,
  ContactAddress,
  ContactRow,
  ContactValue,
  Draft,
  Flags,
  OutgoingAttachment,
  SearchQuery,
  StoredContact,
} from '@mailbowox/core-native';

type EnumName<E> = Uncapitalize<Extract<keyof E, string>>;

export type Security = EnumName<typeof NativeSecurity>;
export type MailboxRole = EnumName<typeof NativeMailboxRole>;
export type Category = EnumName<typeof NativeCategory>;
export type TlsFailure = EnumName<typeof NativeTlsFailure>;
export type DiscoverySource = 'autoconfig' | 'ispdb' | 'provider' | 'srv' | 'mx' | 'probe';

export type ServerConfig = Omit<NativeServerConfig, 'security'> & { security: Security };
export type AccountConfig = Omit<NativeAccountConfig, 'imap' | 'smtp'> & { imap: ServerConfig; smtp: ServerConfig };
export type Mailbox = Omit<NativeMailbox, 'role'> & { role?: MailboxRole };
export type MessageSummary = Omit<NativeMessageSummary, 'date' | 'category'> & { date: number; category: Category };
export type ListFilter = Omit<NativeListFilter, 'category' | 'since'> & { category?: Category; since?: number };
export type MessageBody = NativeMessageBody;
export type MailItem = Omit<NativeMailItem, 'summary'> & { summary: MessageSummary };
type StoredMessage = Omit<NativeStoredMessage, 'summary'> & { summary: MessageSummary };
// `latest` is the newest message in the viewed mailbox, `inView` all of them there, `messages` the whole
// conversation across the account's mailboxes; oldest first.
export type Conversation = { latest: StoredMessage; messages: StoredMessage[]; inView: StoredMessage[] };
export type Cursor = { date: number; account: string; uid: number };
type Oldest = { uid: number; date: number; uidValidity: number };
export type QueuedMessage = { id: number; account: string; queuedAt: number; error: string | null; draft: Draft };
// A composer's local draft attachment; `data` is missing while a forwarded one is still downloading.
export type DraftAttachment = { key: string; filename: string; mimeType: string; size: number; data?: ArrayBuffer };
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
  syncContacts(config: AccountConfig, account: string, home: string): Promise<void>;
  addressBooks(): Promise<(AddressBook & { account: string })[]>;
  putContact(account: string, book: string, contact: Contact): Promise<void>;
  removeContact(account: string, href: string): Promise<void>;
  contacts(words: string[]): Promise<ContactRow[]>;
  contactAddresses(): Promise<ContactAddress[]>;
  contact(account: string, href: string): Promise<StoredContact | undefined>;
  enqueue(account: string, draft: Draft, error: string | null): Promise<number>;
  queuedMessages(): Promise<QueuedMessage[]>;
  queuedMessage(id: number): Promise<QueuedMessage | undefined>;
  queuedAttachments(id: number): Promise<OutgoingAttachment[]>;
  removeQueued(id: number): Promise<void>;
  setQueuedError(id: number, error: string | null): Promise<void>;
  setDraftAttachments(slot: string, attachments: DraftAttachment[]): Promise<void>;
  setOwnAddresses(account: string, emails: string[]): Promise<void>;
  avatar(email: string): Promise<{ source?: string; checkedAt: number } | undefined>;
  setAvatar(email: string, source: string | undefined): Promise<void>;
  moveSender(account: string, email: string, category: Category): Promise<void>;
  draftAttachments(slot: string): Promise<DraftAttachment[]>;
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
  createContact(config: AccountConfig, addressBook: string, draft: ContactDraft): Promise<Contact>;
  updateContact(config: AccountConfig, contact: Contact, draft: ContactDraft): Promise<Contact>;
  deleteContact(config: AccountConfig, href: string, etag: string | undefined): Promise<void>;
  unsubscribeOneClick(url: string): Promise<void>;
  openStore(path: string): Promise<MailStore>;
  openStoreWith(run: (request: ArrayBuffer) => Promise<ArrayBuffer>, database: string): Promise<MailStore>;
}
