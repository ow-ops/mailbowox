import { router } from 'expo-router';

import { openedCopy } from './opened-copy';

export async function openFile(name: string, mimeType: string, data: ArrayBuffer) {
  const file = await openedCopy(name, data);
  router.push({ pathname: '/attachment', params: { uri: file.uri, name, mimeType } });
}
