import type { MessageSummary } from '@/core';

import { addOlder, oldest, type Cursor } from './db';
import type { MailboxRef, MessageRef, StoredItem } from './refs';

type Page = (boxes: MailboxRef[], before: Cursor | undefined, limit: number) => Promise<StoredItem[]>;

type FetchOlder = (before: MessageRef) => Promise<MessageSummary[]>;

const exhausted = new Map<string, number>();
const boxKey = (box: MailboxRef) => `${box.account}\n${box.mailbox}`;

// After a sync that started the list over, the mailbox has older mail to fetch again.
export const resumePaging = (box: MailboxRef) => exhausted.delete(boxKey(box));

// The first page is what sync stored. A later page is final only once no mailbox's local copy ends before
// it does; until then that mailbox's older mail could belong in it, so fetch and read again. One fetch may
// not be enough, as a page of conversations can span many messages.
export async function loadPage(
  boxes: MailboxRef[],
  cursor: Cursor | undefined,
  page: Page,
  limit: number,
  fetchOlder: FetchOlder,
) {
  let items = await page(boxes, cursor, limit);
  if (!cursor) return items;
  for (;;) {
    const end = items.length === limit ? items[items.length - 1].summary.date : -Infinity;
    const behind: MessageRef[] = [];
    for (const box of boxes) {
      const local = await oldest(box);
      if (local && local.uidValidity !== exhausted.get(boxKey(box)) && local.date > end) {
        behind.push({ ...box, uid: local.uid, uidValidity: local.uidValidity });
      }
    }
    if (behind.length === 0) return items;
    await Promise.all(
      behind.map(async (box) => {
        const older = await fetchOlder(box);
        if (older.length === 0) exhausted.set(boxKey(box), box.uidValidity);
        await addOlder(box, older);
      }),
    );
    items = await page(boxes, cursor, limit);
  }
}
