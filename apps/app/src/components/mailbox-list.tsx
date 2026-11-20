import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as v from 'valibot';
import { createStore, useStore } from 'zustand';

import { useAccounts, type Account } from '@/accounts/store';
import { AccountDot } from '@/components/account-mark';
import { ThemedText } from '@/components/themed-text';
import { Press, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Mailbox } from '@/core';
import { mailboxDepth, mailboxIcon, mailboxLabel, orderMailboxes } from '@/mail/mailboxes';
import { useMailboxes, useUnreadCount } from '@/mail/queries';
import { INBOX, sameView, type MailView } from '@/mail/view';
import { writeItem } from '@/utils/kv';
import { readJson } from '@/utils/stored';

// The accounts folded in the mailbox switcher, kept on this device only.
const KEY = 'mailboxes.collapsed';

const collapsedStore = createStore<string[]>(() => readJson(KEY, v.array(v.string()), []));

collapsedStore.subscribe((ids) => writeItem(KEY, JSON.stringify(ids)));

const useCollapsed = (account: string) => useStore(collapsedStore, (ids) => ids.includes(account));

function toggleCollapsed(account: string) {
  const ids = collapsedStore.getState();
  collapsedStore.setState(ids.includes(account) ? ids.filter((id) => id !== account) : [...ids, account], true);
}

const ALL_INBOXES: SymbolViewProps['name'] = { ios: 'tray.2', android: 'all_inbox', web: 'all_inbox' };
const ALL_UNREAD: SymbolViewProps['name'] = {
  ios: 'envelope.badge',
  android: 'mark_email_unread',
  web: 'mark_email_unread',
};

// Until the first sync lists the account's mailboxes, the inbox is the one we know exists.
const FALLBACK: Mailbox[] = [{ name: INBOX, role: 'inbox', selectable: true }];

// `current` is null when the mail list is not on screen, as beside the calendar.
type Props = { current: MailView | null; onSelect: (view: MailView) => void };

export function MailboxList({ current, onSelect }: Props) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const inboxUnread = useUnreadCount({ kind: 'unified' });
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {accounts.length > 1 && (
        <View style={styles.account}>
          <MailboxRow
            icon={ALL_INBOXES}
            label={t('mail.allInboxes')}
            unread={inboxUnread}
            selected={current?.kind === 'unified'}
            onPress={() => onSelect({ kind: 'unified' })}
          />
          {/* Everything in it is unread, so a count would repeat the one beside All inboxes. */}
          <MailboxRow
            icon={ALL_UNREAD}
            label={t('mail.allUnread')}
            selected={current?.kind === 'unread'}
            onPress={() => onSelect({ kind: 'unread' })}
          />
        </View>
      )}
      {accounts.map((account) => (
        <AccountMailboxes
          key={account.id}
          account={account}
          collapsible={accounts.length > 1}
          current={current}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
}

type AccountProps = { account: Account; collapsible: boolean } & Props;

function AccountMailboxes({ account, collapsible, current, onSelect }: AccountProps) {
  const { data } = useMailboxes(account.id);
  const collapsed = useCollapsed(account.id) && collapsible;
  const mailboxes = data?.mailboxes.length ? orderMailboxes(data.mailboxes) : FALLBACK;
  return (
    <View style={styles.account}>
      {collapsible ? (
        <AccountHeader account={account} collapsed={collapsed} unread={data?.unread[INBOX]} />
      ) : (
        <ThemedText type="meta" numberOfLines={1} style={styles.accountTitle} accessibilityRole="header">
          {account.email}
        </ThemedText>
      )}
      {!collapsed && mailboxes.map((mailbox) => {
        const view: MailView = { kind: 'mailbox', account: account.id, mailbox: mailbox.name };
        return (
          <MailboxRow
            key={mailbox.name}
            icon={mailboxIcon(mailbox)}
            label={mailboxLabel(mailbox)}
            depth={mailboxDepth(mailbox)}
            unread={data?.unread[mailbox.name]}
            selected={!!current && sameView(view, current)}
            onPress={() => onSelect(view)}
          />
        );
      })}
    </View>
  );
}

// Collapsed, an account shows its inbox's unread count in the header instead of its mailboxes.
function AccountHeader({ account, collapsed, unread }: { account: Account; collapsed: boolean; unread?: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => toggleCollapsed(account.id)}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={
        collapsed && unread ? t('mail.mailboxes.unreadLabel', { label: account.email, count: unread }) : account.email
      }
      style={({ pressed }) => [styles.accountHeader, pressed && { opacity: Press.opacity }]}>
      <AccountDot account={account} />
      <ThemedText type="meta" numberOfLines={1} style={styles.label}>
        {account.email}
      </ThemedText>
      {collapsed && !!unread && <ThemedText type="meta">{unread}</ThemedText>}
      <SymbolView
        name={
          collapsed
            ? { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
            : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
        }
        size={12}
        tintColor={theme.muted}
      />
    </Pressable>
  );
}

type RowProps = {
  icon: SymbolViewProps['name'];
  label: string;
  depth?: number;
  unread?: number;
  selected: boolean;
  onPress: () => void;
};

export function MailboxRow({ icon, label, depth = 0, unread, selected, onPress }: RowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={unread ? t('mail.mailboxes.unreadLabel', { label, count: unread }) : label}
      style={({ pressed }) => [
        styles.row,
        { paddingLeft: Spacing.three + depth * Spacing.four },
        pressed && { backgroundColor: theme.surface },
        selected && { backgroundColor: theme.accentSoft },
      ]}>
      <SymbolView name={icon} size={20} tintColor={selected ? theme.onAccentSoft : theme.muted} />
      <ThemedText type="label" themeColor={selected ? 'onAccentSoft' : 'heading'} numberOfLines={1} style={styles.label}>
        {label}
      </ThemedText>
      {!!unread && (
        <ThemedText type="labelSmall" themeColor={selected ? 'onAccentSoft' : 'muted'} style={styles.count}>
          {unread}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.two,
    gap: Spacing.three,
  },
  account: {
    gap: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.oneHalf,
    minHeight: TouchTarget,
    paddingRight: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  label: {
    flex: 1,
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.three,
  },
  accountTitle: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
});