import { shareFile } from './share-file';

// What a browser shows by itself opens in a tab; the rest downloads.
const VIEWABLE = /^(image\/|text\/plain$|application\/pdf$)/;

export async function openFile(name: string, mimeType: string, data: ArrayBuffer) {
  if (!VIEWABLE.test(mimeType)) return shareFile(name, mimeType, data);
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
