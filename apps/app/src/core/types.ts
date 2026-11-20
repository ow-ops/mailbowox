import type {
  AddressBook,
  AttachmentInfo,
  Contact,
  ContactDraft,
  ContactSyncResult,
  ContactSyncState,
  ContactTag,
  Draft,
  Flags,
  KnownMessage,
  MailboxUids,
  SyncState,
  AccountConfig as NativeAccountConfig,
  DiscoveredSettings as NativeDiscoveredSettings,
  Mailbox as NativeMailbox,
  MailboxRole as NativeMailboxRole,
  MessageBody as NativeMessageBody,
  MessageSummary as NativeMessageSummary,
  Security as NativeSecurity,
  ServerConfig as NativeServerConfig,
  SyncResult as NativeSyncResult,
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
  KnownMessage,
  OutgoingAttachment,
  SyncState,
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
export type SyncResult = Omit<NativeSyncResult, 'changed'> & { changed: MessageSummary[] };
export type DiscoveredSettings = Omit<NativeDiscoveredSettings, 'imap' | 'smtp' | 'source'> & {
  imap?: ServerConfig;
  smtp?: ServerConfig;
  source: DiscoverySource;
};

export interface MailSession {
  listMailboxes(): Promise<Mailbox[]>;
  createMailbox(name: string): Promise<void>;
  sync(mailbox: string, since: SyncState | undefined, known: KnownMessage[], limit: number): Promise<SyncResult>;
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
}
