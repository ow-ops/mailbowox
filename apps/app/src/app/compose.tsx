import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAccounts } from '@/accounts/store';
import { Composer } from '@/components/composer';
import { QueryState } from '@/components/query-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addressName } from '@/mail/address';
import { getLastFrom, newMessageSender, replySender, senders } from '@/mail/from';
import type { MessageRef } from '@/mail/refs';
import { useBody, useMessage } from '@/mail/queries';
import { replyPrefill, type ReplyMode } from '@/mail/reply';
import { useMailView } from '@/mail/view';
import { fullTime } from '@/utils/time';

type Params = { mode?: ReplyMode; account?: string; mailbox?: string; uid?: string; uidValidity?: string; to?: string };

export default function ComposeScreen() {
  const { mode, account, mailbox, uid, uidValidity, to } = useLocalSearchParams<Params>();
  const accounts = useAccounts();
  const view = useMailView();
  if (mode && account && mailbox && uid) {
    return <ReplyComposer mode={mode} message={{ account, mailbox, uid: Number(uid), uidValidity: Number(uidValidity ?? 0) }} />;
  }
  // A contact opens the composer from the account it belongs to.
  const sender = senders(accounts).find((s) => s.account === account) ?? newMessageSender(accounts, view, getLastFrom());
  return <Composer sender={sender} recipient={to ? { email: to } : undefined} />;
}

function ReplyComposer({ mode, message }: { mode: ReplyMode; message: MessageRef }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const accounts = useAccounts();
  const item = useMessage(message);
  const body = useBody(message, false);

  if (item.error || body.error) {
    return (
      <View style={styles.state}>
        <QueryState pending={false} error={item.error ?? body.error} onRetry={() => void body.refetch()} />
      </View>
    );
  }
  if (!item.data || !body.data) return <ActivityIndicator color={theme.muted} style={styles.state} />;

  const original = item.data.summary;
  const list = (addresses: typeof original.to) => addresses.map(addressName).join(', ');
  const header =
    mode === 'forward'
      ? [
          t('compose.quote.forwarded'),
          t('compose.quote.from', { list: list(original.from) }),
          t('compose.quote.date', { date: fullTime(original.date) }),
          t('compose.quote.subject', { subject: original.subject }),
          t('compose.quote.to', { list: list(original.to) }),
        ].join('\n')
      : t('compose.quote.wrote', { date: fullTime(original.date), name: list(original.from) });
  const sender = replySender(accounts, original, message.account);
  const own = senders(accounts)
    .filter((s) => s.account === sender.account)
    .map((s) => s.address);

  return (
    <Composer
      sender={sender}
      mode={mode}
      original={message}
      prefill={replyPrefill(original, body.data, mode, own, header)}
    />
  );
}

const styles = StyleSheet.create({
  state: { padding: Spacing.five },
});
