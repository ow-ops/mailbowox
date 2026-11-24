import { deleteDatabaseAsync } from 'expo-sqlite';

import { readItem, writeItem } from '@/utils/kv';

const REMOVED = 'legacy.removed';

// mail.db and contacts.db held the mail cache, the outbox and the contacts before the core's store took them over.
export async function removeLegacyData() {
  if (readItem(REMOVED)) return;
  await Promise.all(['mail.db', 'contacts.db'].map((name) => deleteDatabaseAsync(name).catch(() => {})));
  writeItem(REMOVED, '1');
}
