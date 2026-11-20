import { accountConfig, type Account } from '@/accounts/store';
import { core, type Draft } from '@/core';
import { t } from '@/i18n';

import { roleMailbox } from './db';
import { withSession } from './session';
import { syncMailbox } from './sync';

// Resolves to false when the message went out but no copy could be filed in Sent. Nothing after the send may throw:
// the outbox would take it for a failed send and send the message again.
export async function deliver(account: Account, draft: Draft) {
  const raw = await core.sendMessage(await accountConfig(account), draft);
  try {
    const sent = await roleMailbox(account.id, 'sent');
    if (!sent) return false;
    await withSession(account.id, (s) => s.append(sent, raw, { seen: true }));
    // Brings the copy into its conversation now; if this fails, the watcher's next sync of Sent does it.
    syncMailbox({ account: account.id, mailbox: sent }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function saveDraft(account: Account, draft: Draft) {
  const drafts = await roleMailbox(account.id, 'drafts');
  if (!drafts) throw new Error(t('compose.errors.noDrafts'));
  const raw = await core.buildMessage(draft);
  await withSession(account.id, (s) => s.append(drafts, raw, { draft: true, seen: true }));
}
