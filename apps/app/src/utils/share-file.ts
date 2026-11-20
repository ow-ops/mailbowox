import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// The share sheet needs a file, and on Android it returns before the receiving app has read it, so the copy
// can't go when the sheet closes. It goes with the next share instead: one attachment at most stays in the cache.
export async function shareFile(name: string, mimeType: string, data: ArrayBuffer) {
  const shared = new Directory(Paths.cache, 'shared');
  if (shared.exists) shared.delete();
  shared.create();
  const file = new File(shared, name.replaceAll('/', '_'));
  await file.write(new Uint8Array(data));
  await Sharing.shareAsync(file.uri, { mimeType });
}
