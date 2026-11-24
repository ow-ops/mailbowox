import { startActivityAsync } from 'expo-intent-launcher';

import { openedCopy } from './opened-copy';
import { shareFile } from './share-file';

// The app that handles the type opens it; with none installed, the share sheet offers the rest.
export async function openFile(name: string, mimeType: string, data: ArrayBuffer) {
  const file = await openedCopy(name, data);
  try {
    await startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: mimeType, flags: 1 });
  } catch {
    await shareFile(name, mimeType, data);
  }
}
