import type { SymbolViewProps } from 'expo-symbols';

import type { Mailbox, MailboxRole } from '@/core';
import { t } from '@/i18n';

import { mailStore } from './store';

const ROLE_ORDER: MailboxRole[] = ['inbox', 'drafts', 'sent', 'archive', 'flagged', 'all', 'junk', 'trash'];

const ROLE_ICONS: Record<MailboxRole, SymbolViewProps['name']> = {
  inbox: { ios: 'tray', android: 'inbox', web: 'inbox' },
  drafts: { ios: 'doc', android: 'draft', web: 'draft' },
  sent: { ios: 'paperplane', android: 'send', web: 'send' },
  archive: { ios: 'archivebox', android: 'archive', web: 'archive' },
  flagged: { ios: 'flag', android: 'flag', web: 'flag' },
  all: { ios: 'tray.2', android: 'all_inbox', web: 'all_inbox' },
  junk: { ios: 'xmark.bin', android: 'report', web: 'report' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
};

const FOLDER_ICON: SymbolViewProps['name'] = { ios: 'folder', android: 'folder', web: 'folder' };

export const mailboxIcon = (mailbox: Mailbox) => (mailbox.role ? ROLE_ICONS[mailbox.role] : FOLDER_ICON);

const leaf = (mailbox: Mailbox) =>
  mailbox.delimiter ? (mailbox.name.split(mailbox.delimiter).at(-1) ?? mailbox.name) : mailbox.name;

// Servers name special-use mailboxes freely ("INBOX", "Sent Messages"), so roles get one consistent name.
export const mailboxLabel = (mailbox: Mailbox) => (mailbox.role ? t(`mail.roles.${mailbox.role}`) : leaf(mailbox));

export const mailboxDepth = (mailbox: Mailbox) =>
  mailbox.role || !mailbox.delimiter ? 0 : mailbox.name.split(mailbox.delimiter).length - 1;

// Role mailboxes first in a fixed order, then the rest in server order so folders stay under their parents.
export function orderMailboxes(mailboxes: Mailbox[]) {
  const rank = (m: Mailbox) => (m.role ? ROLE_ORDER.indexOf(m.role) : ROLE_ORDER.length);
  return mailboxes.filter((m) => m.selectable).sort((a, b) => rank(a) - rank(b));
}

export async function roleMailbox(account: string, role: MailboxRole) {
  return (await (await mailStore()).mailboxes(account)).find((m) => m.role === role)?.name;
}
