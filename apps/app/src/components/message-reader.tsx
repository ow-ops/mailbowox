import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccounts } from '@/accounts/store';
import { AccountMark } from '@/components/account-mark';
import { Button } from '@/components/button';
import { IconButton } from '@/components/icon-button';
import { MailBody } from '@/components/mail-body';
import { NativeMenu } from '@/components/native-menu';
import { QueryState } from '@/components/query-state';
import { ShortcutTooltip } from '@/components/shortcut-tooltip';
import { ThemedText } from '@/components/themed-text';
import type { Address, AttachmentInfo, Category, MessageBody } from '@/core';
import { explainError } from '@/core/errors';
import { Hairline, Press, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useTheme } from '@/hooks/use-theme';
import { useMessageActions, useSetFlag } from '@/mail/actions';
import { addressName, formatAddress } from '@/mail/address';
import { messageKey, messageParams, sameMessage, type MessageRef, type StoredItem , single, type Conversation } from '@/mail/refs';
import { useBody, useConversation } from '@/mail/queries';
import { remoteNotice } from '@/mail/remote-notice';
import { unsubscribe, unsubscribeMethods } from '@/mail/unsubscribe';
import type { ReplyMode } from '@/mail/reply';
import { withSession } from '@/mail/session';
import { useMailView } from '@/mail/view';
import { setPref, usePref } from '@/prefs/store';
import { mailStore } from '@/mail/store';
import { invalidateMail } from '@/utils/query-client';
import { shareFile } from '@/utils/share-file';
import { confirmAction } from '@/utils/dialog';
import { formatSize } from '@/utils/size';
import { showError, showToast } from '@/utils/toast';
import { fullTime, listTime } from '@/utils/time';

type MessageReaderProps = {
  message: MessageRef;
  onClose: () => void;
  // Runs once the message is no longer in its mailbox: archived, moved, deleted, or gone on the server.
  onGone?: () => void;
};

export function MessageReader({ message, onClose, onGone = onClose }: MessageReaderProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { data: conversation, isPending, isSuccess } = useConversation(message);
  const gone = isSuccess && !conversation;
  useShortcuts({ u: onClose, Escape: onClose });

  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);

  if (isPending) return <ActivityIndicator color={theme.muted} style={styles.loading} />;
  if (!conversation)
    return (
      <ThemedText themeColor="muted" style={styles.loading}>
        {t('mail.reader.gone')}
      </ThemedText>
    );
  return <ConversationReader conversation={conversation} />;
}

// The newest message starts expanded, the others collapsed; expanding one collapses the rest, as only one
// body fits beside the headers. Mail arriving while the reader is open, your reply included, joins
// collapsed.
function ConversationReader({ conversation }: { conversation: Conversation }) {
  const { messages } = conversation;
  const [chosen, setChosen] = useState<MessageRef>(() => messages[messages.length - 1]);
  const [unfolded, setUnfolded] = useState(false);
  const expanded = messages.find((m) => sameMessage(m, chosen)) ?? messages[messages.length - 1];
  const position = messages.indexOf(expanded);
  const older = messages.slice(0, position);
  // A long conversation keeps its first and last earlier messages and folds the ones between.
  const hidden = unfolded || older.length <= 3 ? [] : older.slice(1, -1);
  const { mutate: setFlag } = useSetFlag();

  // Opening marks the conversation read once; after that, "Mark as unread" must stick.
  const marked = useRef(false);
  const markRead = () => {
    if (marked.current) return;
    marked.current = true;
    const unread = messages.filter((m) => !m.summary.flags.seen);
    if (unread.length) setFlag({ items: unread, flag: 'seen', value: true });
  };

  const collapsed = (items: StoredItem[]) =>
    items.map((item) => <CollapsedMessage key={messageKey(item)} item={item} onExpand={() => setChosen(item)} />);

  return (
    <Reader
      key={messageKey(expanded)}
      item={expanded}
      subject={messages[0].summary.subject}
      older={
        hidden.length
          ? [
              ...collapsed(older.slice(0, 1)),
              <Fold key="fold" count={hidden.length} onUnfold={() => setUnfolded(true)} />,
              ...collapsed(older.slice(-1)),
            ]
          : collapsed(older)
      }
      newer={collapsed(messages.slice(position + 1))}
      onLoaded={markRead}
    />
  );
}

function Fold({ count, onUnfold }: { count: number; onUnfold: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable
      onPress={onUnfold}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.collapsedMessage,
        { borderColor: theme.border, backgroundColor: pressed ? theme.surface : undefined },
      ]}>
      <ThemedText type="meta" themeColor="primary">
        {t('mail.reader.earlier', { count })}
      </ThemedText>
    </Pressable>
  );
}

function CollapsedMessage({ item, onExpand }: { item: StoredItem; onExpand: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { summary } = item;
  const sender = summary.from[0] ? addressName(summary.from[0]) : t('mail.row.nobody');
  const time = listTime(summary.date);
  return (
    <Pressable
      onPress={onExpand}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      accessibilityLabel={[!summary.flags.seen && t('mail.row.unread'), sender, time, summary.preview]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={t('mail.reader.expand')}
      style={({ pressed }) => [
        styles.collapsedMessage,
        { borderColor: theme.border, backgroundColor: pressed ? theme.surface : undefined },
      ]}>
      <ThemedText type="labelSmall" numberOfLines={1} style={styles.collapsedSender}>
        {sender}
      </ThemedText>
      <ThemedText type="meta" numberOfLines={1} style={styles.grow}>
        {summary.preview}
      </ThemedText>
      <ThemedText type="meta">{time}</ThemedText>
    </Pressable>
  );
}

type ReaderProps = {
  item: StoredItem;
  subject: string;
  older: ReactNode[];
  newer: ReactNode[];
  onLoaded: () => void;
};

function Reader({ item, subject, older, newer, onLoaded }: ReaderProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const remotePref = usePref('remoteContent');
  const trusted = usePref('remoteSenders');
  const sender = item.summary.from[0];
  const always = remotePref === 'ask' && !!sender && trusted.includes(sender.email.toLowerCase());
  const [loaded, setLoaded] = useState(false);
  const allowRemote = loaded || always;
  const body = useBody(item, allowRemote);
  // iOS draws the navigation bar over the screen; the header scroll is capped, so it cannot take the inset itself.
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    if (body.data) onLoaded();
  }, [body.data, onLoaded]);

  const attachments = body.data?.attachments.filter((a) => !a.inline) ?? [];

  return (
    <View style={[styles.reader, Platform.OS === 'ios' && { paddingTop: headerHeight }]}>
      <ScrollView style={styles.head} contentContainerStyle={styles.headContent}>
        <ThemedText type="headline" accessibilityRole="header" style={styles.subject}>
          {subject || t('mail.row.noSubject')}
        </ThemedText>
        {older.length > 0 && <View style={[styles.older, { borderBottomColor: theme.border }]}>{older}</View>}
        <Header item={item} />
        {attachments.length > 0 && <Attachments message={item} attachments={attachments} />}
      </ScrollView>
      {body.data?.hasRemoteContent && !allowRemote && (
        <View style={styles.remote}>
          <SymbolView
            name={{ ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }}
            size={16}
            tintColor={theme.muted}
          />
          <ThemedText type="meta" style={styles.grow}>
            {remoteNotice(t, body.data.blockedRemote, sender, remotePref)}
          </ThemedText>
          {remotePref === 'ask' && (
            <Button label={t('mail.reader.loadRemote')} variant="outline" size="small" onPress={() => setLoaded(true)} />
          )}
        </View>
      )}
      {loaded && !always && sender && (
        <View style={styles.remote}>
          <SymbolView name={{ ios: 'eye', android: 'visibility', web: 'visibility' }} size={16} tintColor={theme.muted} />
          <ThemedText type="meta" style={styles.grow}>
            {t('mail.reader.remoteLoaded', { name: addressName(sender) })}
          </ThemedText>
          <Button
            label={t('mail.reader.alwaysLoad')}
            accessibilityLabel={t('mail.reader.alwaysLoadFrom', { name: addressName(sender) })}
            variant="outline"
            size="small"
            onPress={() => setPref('remoteSenders', [...trusted, sender.email.toLowerCase()])}
          />
        </View>
      )}
      {body.data && <Unsubscribe item={item} body={body.data} />}
      <View style={[styles.body, { borderTopColor: theme.border }]}>
        {body.data ? (
          body.data.html ? (
            <MailBody html={body.data.html} allowRemote={allowRemote} />
          ) : (
            <ScrollView contentContainerStyle={styles.text}>
              <ThemedText selectable>{body.data.text ?? ''}</ThemedText>
            </ScrollView>
          )
        ) : (
          <View style={styles.loading}>
            <QueryState pending={body.isPending} error={body.error} onRetry={() => void body.refetch()} />
          </View>
        )}
      </View>
      {newer.length > 0 && <ScrollView style={styles.newer}>{newer}</ScrollView>}
      <ActionBar item={item} />
    </View>
  );
}

function Unsubscribe({ item, body }: { item: StoredItem; body: MessageBody }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const methods = unsubscribeMethods(body);
  const sender = item.summary.from[0];
  const name = sender ? addressName(sender) : t('mail.reader.theSender');
  const run = useMutation({
    mutationFn: () => unsubscribe(item, methods),
    onSuccess: (outcome) => {
      if (outcome === 'done') showToast(t('mail.unsubscribe.done', { name }));
    },
    onError: (error) => showError(t('mail.unsubscribe.failed'), error instanceof Error ? error.message : undefined),
  });
  if (!methods.length || run.data === 'done') return null;
  return (
    <View style={styles.remote}>
      <SymbolView
        name={{ ios: 'envelope.badge.person.crop', android: 'unsubscribe', web: 'unsubscribe' }}
        size={16}
        tintColor={theme.muted}
      />
      <ThemedText type="meta" style={styles.grow}>
        {t('mail.unsubscribe.notice', { name })}
      </ThemedText>
      <Button
        label={t('mail.unsubscribe.action')}
        accessibilityLabel={t('mail.unsubscribe.confirm', { name })}
        variant="outline"
        size="small"
        loading={run.isPending}
        onPress={() => confirmAction(t('mail.unsubscribe.confirm', { name }), t('mail.unsubscribe.action'), () => run.mutate())}
      />
    </View>
  );
}

// Below this width, Reply all, Forward, Flag and Mark as unread move into the More menu.
const FULL_BAR = 560;

function ActionBar({ item }: { item: StoredItem }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const actions = useMessageActions(single(item));
  const { flags } = item.summary;
  const full = width >= FULL_BAR;

  const reply = (mode: ReplyMode) =>
    router.push({
      pathname: '/compose',
      params: { mode, ...messageParams(item) },
    });
  const flagLabel = flags.flagged ? t('mail.actions.unflag') : t('mail.actions.flag');
  const seenLabel = flags.seen ? t('mail.actions.markUnread') : t('mail.actions.markRead');
  useShortcuts({
    e: actions.archive,
    '#': actions.remove,
    s: actions.toggleFlagged,
    '*': actions.toggleFlagged,
    r: () => reply('reply'),
    a: () => reply('replyAll'),
    f: () => reply('forward'),
  });

  return (
    <SafeAreaView
      edges={['bottom']}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.actionBar, { borderTopColor: theme.border }]}>
      <ShortcutTooltip label={t('mail.actions.archive')} shortcut="e">
        <IconButton
          icon={{ ios: 'archivebox', android: 'archive', web: 'archive' }}
          label={t('mail.actions.archive')}
          disabled={!actions.archive}
          onPress={() => actions.archive?.()}
        />
      </ShortcutTooltip>
      <ShortcutTooltip label={t('mail.actions.delete')} shortcut="#">
        <IconButton
          icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
          label={t('mail.actions.delete')}
          onPress={actions.remove}
        />
      </ShortcutTooltip>
      <ShortcutTooltip label={t('mail.actions.move')}>
        <IconButton
          icon={{ ios: 'folder', android: 'drive_file_move', web: 'drive_file_move' }}
          label={t('mail.actions.move')}
          onPress={() =>
            router.push({
              pathname: '/move',
              params: messageParams(item),
            })
          }
        />
      </ShortcutTooltip>
      {full ? (
        <View style={styles.marks}>
          <ShortcutTooltip label={flagLabel} shortcut="s">
            <IconButton
              icon={
                flags.flagged
                  ? { ios: 'flag.fill', android: 'flag', web: 'flag' }
                  : { ios: 'flag', android: 'outlined_flag', web: 'outlined_flag' }
              }
              label={flagLabel}
              active={flags.flagged}
              onPress={actions.toggleFlagged}
            />
          </ShortcutTooltip>
          <ShortcutTooltip label={seenLabel}>
            <IconButton
              icon={{ ios: 'envelope.badge', android: 'mark_email_unread', web: 'mark_email_unread' }}
              label={seenLabel}
              onPress={actions.toggleSeen}
            />
          </ShortcutTooltip>
        </View>
      ) : (
        <NativeMenu
          label={t('mail.actions.more')}
          groups={[
            [
              {
                key: 'replyAll',
                title: t('mail.actions.replyAll'),
                icon: 'arrowshape.turn.up.left.2',
                onPress: () => reply('replyAll'),
              },
              {
                key: 'forward',
                title: t('mail.actions.forward'),
                icon: 'arrowshape.turn.up.right',
                onPress: () => reply('forward'),
              },
            ],
            [
              {
                key: 'flag',
                title: flagLabel,
                icon: flags.flagged ? 'flag.slash' : 'flag',
                onPress: actions.toggleFlagged,
              },
              {
                key: 'seen',
                title: seenLabel,
                icon: flags.seen ? 'envelope.badge' : 'envelope.open',
                onPress: actions.toggleSeen,
              },
            ],
          ]}
        />
      )}
      <View style={styles.grow} />
      <View style={styles.replies}>
        {full && (
          <>
            <ShortcutTooltip label={t('mail.actions.forward')} shortcut="f">
              <Button
                label={t('mail.actions.forward')}
                variant="outline"
                size="small"
                onPress={() => reply('forward')}
              />
            </ShortcutTooltip>
            <ShortcutTooltip label={t('mail.actions.replyAll')} shortcut="a">
              <Button
                label={t('mail.actions.replyAll')}
                variant="outline"
                size="small"
                onPress={() => reply('replyAll')}
              />
            </ShortcutTooltip>
          </>
        )}
        <ShortcutTooltip label={t('mail.actions.reply')} shortcut="r">
          <Button label={t('mail.actions.reply')} size="small" onPress={() => reply('reply')} />
        </ShortcutTooltip>
      </View>
    </SafeAreaView>
  );
}

function Header({ item }: { item: StoredItem }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { summary } = item;
  const sender = summary.from[0];
  const recipients = [...summary.to, ...summary.cc];
  const account = useMixedAccount(item);

  return (
    <View style={styles.header}>
      <View>
        <ThemedText type="name">{sender ? addressName(sender) : t('mail.row.nobody')}</ThemedText>
        {sender?.name && (
          <ThemedText type="meta" selectable>
            {sender.email}
          </ThemedText>
        )}
      </View>
      {recipients.length > 0 && (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityHint={t(expanded ? 'mail.reader.hideRecipients' : 'mail.reader.showRecipients')}
          style={({ pressed }) => [styles.recipients, pressed && { opacity: Press.opacity }]}>
          {expanded ? (
            <>
              <ThemedText type="meta" selectable>
                {t('mail.reader.to', { list: summary.to.map(formatAddress).join(', ') })}
              </ThemedText>
              {summary.cc.length > 0 && (
                <ThemedText type="meta" selectable>
                  {t('mail.reader.cc', { list: summary.cc.map(formatAddress).join(', ') })}
                </ThemedText>
              )}
            </>
          ) : (
            <View style={styles.collapsed}>
              <ThemedText type="meta" numberOfLines={1} style={styles.grow}>
                {t('mail.reader.to', { list: recipients.map(addressName).join(', ') })}
              </ThemedText>
              <SymbolView
                name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                size={12}
                tintColor={theme.muted}
              />
            </View>
          )}
        </Pressable>
      )}
      <View style={styles.collapsed}>
        <ThemedText type="meta" style={styles.grow}>
          {fullTime(summary.date)}
        </ThemedText>
        {account && <AccountMark account={account} />}
        {sender && <SenderCategory item={item} sender={sender} />}
      </View>
    </View>
  );
}

const CATEGORY_ICONS: Record<Category, string> = {
  primary: 'person',
  transactions: 'cart',
  updates: 'bell',
  promotions: 'tag',
};

// Moving a sender takes its past and future mail to the category, in this account.
function SenderCategory({ item, sender }: { item: StoredItem; sender: Address }) {
  const { t } = useTranslation();
  const enabled = usePref('inboxCategories');
  if (!enabled) return null;
  const move = async (category: Category) => {
    const label = t(`mail.categories.${category}`);
    try {
      await (await mailStore()).moveSender(item.account, sender.email, category);
      invalidateMail();
      showToast(t('mail.categories.moved', { name: addressName(sender), category: label }));
    } catch (error) {
      showError(t('mail.categories.moveFailed'), explainError(error).summary);
    }
  };
  return (
    <NativeMenu
      label={t('mail.categories.move')}
      groups={[
        (Object.keys(CATEGORY_ICONS) as Category[]).map((category) => ({
          key: category,
          title: t('mail.categories.moveTo', { category: t(`mail.categories.${category}`) }),
          icon: CATEGORY_ICONS[category],
          onPress: () => void move(category),
        })),
      ]}
    />
  );
}

// The reader names the account only where the list it came from mixes accounts.
function useMixedAccount(item: StoredItem) {
  const accounts = useAccounts();
  const view = useMailView();
  const mixed = accounts.length > 1 && (view.kind !== 'mailbox' || view.account !== item.account);
  return mixed ? accounts.find((a) => a.id === item.account) : undefined;
}

function Attachments({ message, attachments }: { message: MessageRef; attachments: AttachmentInfo[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const open = useMutation({
    mutationFn: async (info: AttachmentInfo) => {
      const data = await withSession(message.account, (s) =>
        s.fetchAttachment(message.mailbox, message.uidValidity, message.uid, info),
      );
      await shareFile(info.filename ?? t('mail.reader.attachment'), info.mimeType, data);
    },
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachments}>
      {attachments.map((info) => {
        const name = info.filename ?? t('mail.reader.attachment');
        const busy = open.isPending && open.variables?.index === info.index;
        return (
          <Pressable
            key={info.index}
            onPress={() => open.mutate(info)}
            disabled={open.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('mail.reader.openAttachment', { name, size: formatSize(info.size) })}
            style={({ pressed }) => [
              styles.attachment,
              { borderColor: theme.outline },
              pressed && { opacity: Press.opacity },
            ]}>
            {busy ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <SymbolView
                name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }}
                size={16}
                tintColor={theme.muted}
              />
            )}
            <ThemedText type="labelSmall" numberOfLines={1} style={styles.attachmentName}>
              {name}
            </ThemedText>
            <ThemedText type="meta">{formatSize(info.size)}</ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  reader: { flex: 1 },
  loading: { padding: Spacing.five, alignItems: 'center', textAlign: 'center' },
  head: { flexGrow: 0, maxHeight: '45%' },
  headContent: { paddingTop: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  header: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  subject: { paddingHorizontal: Spacing.three },
  collapsedMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.three,
    borderTopWidth: Hairline,
  },
  collapsedSender: { maxWidth: '40%' },
  older: { borderBottomWidth: Hairline },
  newer: { flexGrow: 0, maxHeight: '30%' },
  recipients: { minHeight: TouchTarget - Spacing.three, justifyContent: 'center', gap: Spacing.half },
  collapsed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  grow: { flex: 1 },
  remote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  attachments: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TouchTarget - Spacing.one,
    maxWidth: 280,
    paddingHorizontal: Spacing.three,
    borderWidth: Hairline,
    borderRadius: Radius.md,
  },
  attachmentName: { flexShrink: 1 },
  body: { flex: 1, borderTopWidth: Hairline },
  text: { padding: Spacing.three },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.one,
    paddingRight: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: Hairline,
  },
  marks: { flexDirection: 'row', marginLeft: Spacing.three },
  replies: { flexDirection: 'row', gap: Spacing.two },
});
