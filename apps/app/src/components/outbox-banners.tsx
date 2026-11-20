import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorExplanation } from '@/components/error-explanation';
import { ThemedText } from '@/components/themed-text';
import { Hairline, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { explainError, explainSendError, isUnconfirmed, restoreError } from '@/core/errors';
import { cancelQueued, sendAgain, useHeldIds, useQueuedMessages, useSendingId } from '@/mail/outbox';
import { showError } from '@/utils/toast';

export function OutboxBanners({ accounts }: { accounts: string[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  // A message still in its undo window has its own toast.
  const held = useHeldIds();
  const queued = useQueuedMessages().data?.filter(
    (message) => accounts.includes(message.account) && !held.includes(message.id),
  );
  const sendingId = useSendingId();
  return queued?.map(({ id, draft, error }) => {
    const subject = draft.subject || draft.to[0]?.email || t('mail.row.noSubject');
    const sending = id === sendingId;
    const failure = error && !sending ? restoreError(error) : undefined;
    const unconfirmed = failure !== undefined && isUnconfirmed(failure);
    const failed = (e: Error) => showError(t('common.actionFailed'), explainError(e).summary);
    return (
      <View key={id} style={[styles.banner, { borderBottomColor: theme.border }]} accessibilityLiveRegion="polite">
        <View style={styles.text}>
          <ThemedText type="label" themeColor={failure ? 'danger' : 'text'}>
            {sending
              ? t('mail.outbox.sending')
              : unconfirmed
                ? t('mail.outbox.unconfirmed')
                : failure
                  ? t('mail.outbox.failed')
                  : t('mail.outbox.waiting')}
          </ThemedText>
          <ThemedText type="meta" numberOfLines={1}>
            {subject}
          </ThemedText>
          {failure !== undefined && <ErrorExplanation {...explainSendError(failure)} />}
        </View>
        {unconfirmed && (
          <Button
            label={t('mail.outbox.sendAgain')}
            accessibilityLabel={t('mail.outbox.sendAgainLabel', { subject })}
            variant="outline"
            size="small"
            onPress={() => void sendAgain(id).catch(failed)}
          />
        )}
        <Button
          label={t('mail.outbox.cancel')}
          accessibilityLabel={t('mail.outbox.cancelLabel', { subject })}
          variant="outline"
          size="small"
          disabled={sending}
          onPress={() => void cancelQueued(id).catch(failed)}
        />
      </View>
    );
  });
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.oneHalf,
    borderBottomWidth: Hairline,
  },
  text: { flex: 1, gap: Spacing.half },
});
