import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';

// The attachment screen shows it in place; the copy stays in the cache until the next one.
export async function openFile(name: string, mimeType: string, data: ArrayBuffer) {
  const opened = new Directory(Paths.cache, 'opened');
  if (opened.exists) opened.delete();
  opened.create();
  const file = new File(opened, name.replaceAll('/', '_'));
  await file.write(new Uint8Array(data));
  router.push({ pathname: '/attachment', params: { uri: file.uri, name, mimeType } });
}
