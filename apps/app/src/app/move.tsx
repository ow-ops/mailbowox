import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { MailboxRow } from '@/components/mailbox-list';
import { Spacing } from '@/constants/theme';
import { useMoveMessages } from '@/mail/actions';
import { mailboxDepth, mailboxIcon, mailboxLabel, orderMailboxes } from '@/mail/mailboxes';
import { useMailboxes, useMoveItems } from '@/mail/queries';
import { stopSelecting, useMovingItems } from '@/mail/selection';

// Moves one message (uid), a listed conversation (thread), or the selected rows (selection), which may come
// from several mailboxes of the account.
export default function MoveScreen() {
  const params = useLocalSearchParams<{
    account: string;
    mailbox?: string;
    uid?: string;
    uidValidity?: string;
    thread?: string;
    selection?: string;
  }>();
  const box = { account: params.account, mailbox: params.mailbox ?? '', uidValidity: Number(params.uidValidity ?? 0) };
  const target = params.thread ? { thread: params.thread } : params.uid ? { uid: Number(params.uid) } : null;
  const listed = useMoveItems(box, target).data;
  const selected = useMovingItems();
  const items = params.selection ? selected : listed;
  const mailboxes = useMailboxes(params.account).data?.mailboxes ?? [];
  const move = useMoveMessages();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {orderMailboxes(mailboxes)
        .filter((mailbox) => mailbox.name !== params.mailbox)
        .map((mailbox) => (
          <MailboxRow
            key={mailbox.name}
            icon={mailboxIcon(mailbox)}
            label={mailboxLabel(mailbox)}
            depth={mailboxDepth(mailbox)}
            selected={false}
            onPress={() => {
              // Still loading what to move: the sheet stays open rather than closing as if it had.
              if (!items) return;
              move.mutate({ items, destination: { mailbox: mailbox.name } });
              if (params.selection) stopSelecting();
              router.back();
            }}
          />
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.two },
});
