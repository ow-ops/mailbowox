import { Directory, File, Paths } from 'expo-file-system';

// The attachment as a file to hand to a viewer. It stays in the cache until the next one, as the viewer may
// read it after this returns.
export async function openedCopy(name: string, data: ArrayBuffer) {
  const opened = new Directory(Paths.cache, 'opened');
  if (opened.exists) opened.delete();
  opened.create();
  const file = new File(opened, name.replaceAll('/', '_'));
  await file.write(new Uint8Array(data));
  return file;
}
