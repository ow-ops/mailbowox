import type { AttachmentInfo } from '@/core';

import type { MessageRef } from './refs';
import { withSession } from './session';

// One at a time: each fetch downloads the whole original over the account's shared connection. A failed
// attachment is reported and the others still arrive.
export async function fetchForwarded(
  original: MessageRef,
  attachments: AttachmentInfo[],
  loaded: (info: AttachmentInfo, data: ArrayBuffer) => void,
  failed: (info: AttachmentInfo, error: unknown) => void,
) {
  for (const info of attachments) {
    try {
      loaded(info, await withSession(original.account, (s) => s.fetchAttachment(original.mailbox, original.uidValidity, original.uid, info)));
    } catch (error) {
      failed(info, error);
    }
  }
}
