import { AppState } from 'react-native';

import type { Draft } from '@/core';
import { t } from '@/i18n';
import { dismissToast, showError, showToast } from '@/utils/toast';

import { explainError, explainSendError, isUnconfirmed, restoreError } from '@/core/errors';
import { cancelQueued, holdMessage, releaseMessage } from './outbox';
import { mailStore } from './store';

const UNDO_WINDOW = 5000;

// Sends after a few seconds in which Undo takes the message back. `reopen` puts it in a composer again; it
// also runs when the server refuses the message, so it can be corrected.
export async function sendWithUndo(account: string, draft: Draft, reopen: () => void) {
  const id = await holdMessage(account, draft);

  const takeBack = async () => {
    await cancelQueued(id);
    reopen();
  };

  const send = async () => {
    await releaseMessage(id);
    const left = await (await mailStore()).queuedMessage(id);
    if (!left) showToast(t('compose.sent'));
    else if (!left.error) showToast(t('compose.queued'));
    else if (isUnconfirmed(restoreError(left.error))) showToast(t('compose.unconfirmed'));
    else {
      await takeBack();
      showError(t('mail.outbox.failed'), explainSendError(restoreError(left.error)).summary);
    }
  };

  let waiting = true;
  const end = (then: () => Promise<void>) => {
    if (!waiting) return;
    waiting = false;
    clearTimeout(timer);
    subscription.remove();
    dismissToast(toast);
    then().catch((error: unknown) => showError(t('common.actionFailed'), explainError(error).summary));
  };
  const timer = setTimeout(() => end(send), UNDO_WINDOW);
  // A timer may not fire once the app is in the background, so leaving it sends at once. A system sheet or
  // the app switcher only makes the app inactive, and Undo is still there when it comes back.
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') end(send);
  });
  const toast = showToast(
    t('compose.sending'),
    { label: t('mail.actions.undo'), onClick: () => end(takeBack) },
    UNDO_WINDOW,
  );
}
