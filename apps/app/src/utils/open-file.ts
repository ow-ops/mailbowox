import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';

import { shareFile } from './share-file';

// The app that handles the type opens it; with none installed, the share sheet offers the rest. The copy stays
// in the cache until the next one, as the other app reads it after this returns.
export async function openFile(name: string, mimeType: string, data: ArrayBuffer) {
  const opened = new Directory(Paths.cache, 'opened');
  if (opened.exists) opened.delete();
  opened.create();
  const file = new File(opened, name.replaceAll('/', '_'));
  await file.write(new Uint8Array(data));
  try {
    await startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: mimeType, flags: 1 });
  } catch {
    await shareFile(name, mimeType, data);
  }
}
