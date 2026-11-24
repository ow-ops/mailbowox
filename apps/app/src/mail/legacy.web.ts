import { invoke } from '@/utils/desktop';
import { readItem, writeItem } from '@/utils/kv';

const REMOVED = 'legacy.removed';

// The browser kept mail.db and contacts.db in expo-sqlite's OPFS folder before the core's store took them over.
// The desktop shell removes its own copies.
export async function removeLegacyData() {
  if (invoke || readItem(REMOVED)) return;
  const root = await navigator.storage?.getDirectory().catch(() => undefined);
  await root?.removeEntry('expo-sqlite', { recursive: true }).catch(() => {});
  writeItem(REMOVED, '1');
}
