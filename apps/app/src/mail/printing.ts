import type { TFunction } from 'i18next';

import { printHtml } from './print';
import { printDocument } from './print-document';
import type { StoredItem } from './refs';
import { withSession } from './session';
import { mailStore } from './store';

export async function printConversation(t: TFunction, messages: StoredItem[]) {
  const store = await mailStore();
  const bodies = await Promise.all(
    messages.map(async (item) => ({
      item,
      body: (await store.cachedBody(item, false)) ?? (await withSession(item.account, (s) => store.fetchBody(s, item, false))),
    })),
  );
  await printHtml(printDocument(t, bodies));
}
