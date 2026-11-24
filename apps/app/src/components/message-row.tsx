import { Link, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';

import { accountLabel } from '@/accounts/colors';
import type { Account } from '@/accounts/store';
import { AccountMark } from '@/components/account-mark';
import type { SwipeAction } from '@/components/swipe-action';
import { SwipeActions } from '@/components/swipe-actions';
import { ThemedText } from '@/components/themed-text';
import { BorderWidth, Fonts, Hairline, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMessageActions } from '@/mail/actions';
import { addressName, sameAddress } from '@/mail/address';
import { messageParams, type Conversation, type MailItem, type StoredItem } from '@/mail/refs';
import { useBlockedCount, useRoleMailbox } from '@/mail/queries';
import { conversationKey, startSelecting, toggleSelected } from '@/mail/selection';
import { highlight as highlightText } from '@/utils/text';
import { listTime } from '@/utils/time';

type Props = {
  conversation: Conversation;
  // Sent and Drafts list who the message is for rather than who it is from.
  byRecipient: boolean;
  self: string;
  // The mailbox the message is in, when the list mixes mailboxes.
  place?: string;
  // Set when the list mixes accounts.
  account?: Account;
  selected: boolean;
  // In selection mode a tap checks the row instead of opening it.
  selecting: boolean;
  checked: boolean;
  onOpen?: (item: StoredItem) => void;
  // Words a search found, marked in the subject and preview.
  highlight?: string[];
};

// Each sender once, in the order they joined the conversation.
function senders(messages: MailItem[], self: string, me: string) {
  const names = messages.flatMap(({ summary }) =>
    summary.from.map((address) => (sameAddress(address, { email: self }) ? me : addressName(address))),
  );
  return [...new Set(names)].join(', ');
}

export function MessageRow({
  conversation,
  byRecipient,
  self,
  place,
  account,
  selected,
  selecting,
  checked,
  onOpen,
  highlight = [],
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const actions = useMessageActions(conversation);
  const trash = useRoleMailbox(conversation.latest.account, 'trash');
  const key = conversationKey(conversation);
  const { latest: item, messages, inView } = conversation;
  const { summary } = item;
  const unread = messages.some((m) => !m.summary.flags.seen);
  const flagged = messages.some((m) => m.summary.flags.flagged);
  const hasAttachments = messages.some((m) => m.summary.hasAttachments);
  const count = messages.length;
  const people =
    (byRecipient ? summary.to.map(addressName).join(', ') : senders(messages, self, t('mail.row.me'))) ||
    t('mail.row.nobody');
  const subject = summary.subject || t('mail.row.noSubject');
  const time = listTime(summary.date);
  const blocked = (useBlockedCount(item).data ?? 0) > 0;

  const label = [
    unread && t('mail.row.unread'),
    byRecipient ? t('mail.row.to', { people }) : people,
    count > 1 && t('mail.row.messages', { count }),
    subject,
    summary.preview,
    time,
    hasAttachments && t('mail.row.hasAttachments'),
    flagged && t('mail.row.flagged'),
    blocked && t('mail.row.remoteBlocked'),
    place,
    account && t('mail.row.account', { label: accountLabel(account) }),
  ]
    .filter(Boolean)
    .join(', ');

  const accessibilityActions = [
    { name: 'toggleSeen', label: unread ? t('mail.actions.markRead') : t('mail.actions.markUnread') },
    { name: 'toggleFlagged', label: flagged ? t('mail.actions.unflag') : t('mail.actions.flag') },
    ...(actions.archive ? [{ name: 'archive', label: t('mail.actions.archive') }] : []),
    { name: 'remove', label: t('mail.actions.delete') },
    { name: 'move', label: t('mail.actions.move') },
  ];
  const move = () =>
    router.push({
      pathname: '/move',
      params: { ...messageParams(item), thread: inView.length > 1 ? item.thread : undefined },
    });
  const onAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) =>
    ({ ...actions, move })[nativeEvent.actionName as 'toggleSeen' | 'toggleFlagged' | 'archive' | 'remove' | 'move']?.();

  const leading: SwipeAction = {
    icon: unread
      ? { ios: 'envelope.open', android: 'drafts', web: 'drafts' }
      : { ios: 'envelope.badge', android: 'mark_email_unread', web: 'mark_email_unread' },
    label: unread ? t('mail.actions.read') : t('mail.actions.unread'),
    tone: 'primary',
    removes: false,
    run: actions.toggleSeen,
  };
  const trailing: SwipeAction =
    actions.archive && item.mailbox !== trash
      ? {
          icon: { ios: 'archivebox', android: 'archive', web: 'archive' },
          label: t('mail.actions.archive'),
          tone: 'primary',
          removes: true,
          run: actions.archive,
        }
      : {
          icon: { ios: 'trash', android: 'delete', web: 'delete' },
          label: t('mail.actions.delete'),
          tone: 'danger',
          // Deleting for good asks first, so the row comes back until it is confirmed.
          removes: !!trash && trash !== item.mailbox,
          run: actions.remove,
        };

  const row = (
    <Pressable
      onPress={selecting ? () => toggleSelected(key) : onOpen && (() => onOpen(item))}
      onLongPress={selecting ? undefined : () => startSelecting(key)}
      accessibilityRole={selecting ? 'checkbox' : onOpen ? 'button' : 'link'}
      accessibilityLabel={label}
      accessibilityState={selecting ? { checked } : { selected }}
      accessibilityActions={selecting ? undefined : accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}>
      {({ pressed }) => (
        // Styled inside: Link's Slot drops a style function on the Pressable itself.
        <View
          style={[
            styles.row,
            {
              borderBottomColor: theme.border,
              backgroundColor: selected || checked ? theme.accentSoft : pressed ? theme.surface : theme.page,
            },
          ]}>
          {selecting && <Check checked={checked} />}
          <View style={styles.gutter}>
            {unread && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
          </View>
          <View style={styles.text}>
            <View style={styles.line}>
              <View style={[styles.grow, styles.people]}>
                <ThemedText
                  type={unread ? 'name' : 'body'}
                  themeColor={unread ? 'heading' : 'text'}
                  numberOfLines={1}
                  style={[styles.shrink, unread ? styles.unreadName : styles.readName]}>
                  {people}
                </ThemedText>
                {count > 1 && (
                  <ThemedText
                    type="meta"
                    style={[styles.count, { backgroundColor: selected || checked ? theme.page : theme.surface }]}>
                    {count}
                  </ThemedText>
                )}
              </View>
              {account && <AccountMark account={account} />}
              <ThemedText type="meta">{time}</ThemedText>
            </View>
            <View style={styles.line}>
              <ThemedText
                numberOfLines={1}
                themeColor={unread ? 'heading' : 'text'}
                style={[styles.grow, unread && styles.unreadSubject]}>
                <Marked text={subject} words={highlight} />
              </ThemedText>
              {hasAttachments && (
                <SymbolView
                  name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }}
                  size={14}
                  tintColor={theme.muted}
                />
              )}
              {blocked && (
                <SymbolView
                  name={{ ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }}
                  size={14}
                  tintColor={theme.muted}
                />
              )}
              {flagged && (
                <SymbolView
                  name={{ ios: 'flag.fill', android: 'flag', web: 'flag' }}
                  size={14}
                  tintColor={theme.primary}
                />
              )}
            </View>
            {!!summary.preview && (
              <ThemedText type="meta" numberOfLines={2}>
                <Marked text={summary.preview} words={highlight} />
              </ThemedText>
            )}
            {place && (
              <ThemedText type="meta" numberOfLines={1}>
                {place}
              </ThemedText>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );

  return (
    <SwipeActions key={key} leading={leading} trailing={trailing} enabled={!selecting}>
      {onOpen || selecting ? (
        row
      ) : (
        <Link
          href={{ pathname: '/message', params: messageParams(item) }}
          asChild>
          {row}
        </Link>
      )}
    </SwipeActions>
  );
}

function Check({ checked }: { checked: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.check}>
      <View
        style={[
          styles.box,
          checked ? { backgroundColor: theme.primary, borderColor: theme.primary } : { borderColor: theme.outline },
        ]}>
        {checked && (
          <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={14} tintColor={theme.onPrimary} />
        )}
      </View>
    </View>
  );
}

function Marked({ text, words }: { text: string; words: string[] }) {
  const theme = useTheme();
  if (!words.length) return text;
  return highlightText(text, words).map((segment, i) =>
    segment.match ? (
      <ThemedText key={i} style={[styles.match, { color: theme.primary }]}>
        {segment.text}
      </ThemedText>
    ) : (
      segment.text
    ),
  );
}

const styles = StyleSheet.create({
  match: { fontWeight: '600' },
  row: {
    flexDirection: 'row',
    paddingVertical: Spacing.oneHalf,
    paddingRight: Spacing.three,
    borderBottomWidth: Hairline,
  },
  gutter: {
    width: Spacing.five - Spacing.half,
    alignItems: 'center',
    paddingTop: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  people: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  shrink: {
    flexShrink: 1,
  },
  count: {
    minWidth: 22,
    paddingHorizontal: Spacing.one + Spacing.half,
    borderRadius: Radius.sm,
    textAlign: 'center',
    overflow: 'hidden',
  },
  // Unread senders use the display face, read ones the body face.
  unreadName: {
    fontFamily: Fonts.display,
  },
  readName: {
    lineHeight: 21,
    fontWeight: '500',
  },
  unreadSubject: {
    fontWeight: '600',
  },
  check: {
    width: Spacing.five + Spacing.two,
    alignItems: 'flex-end',
    paddingTop: Spacing.half,
  },
  box: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: BorderWidth.input,
  },
});
