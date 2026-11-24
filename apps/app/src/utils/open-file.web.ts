import { shareFile } from './share-file';

// What a browser shows by itself opens in a tab; the rest downloads. The tab has the app's origin, so SVG, which
// can carry script, downloads too.
const VIEWABLE = /^(image\/(?!svg)|text\/plain$|application\/pdf$)/;

export async function openFile(name: string, mimeType: string, data: ArrayBuffer) {
  if (!VIEWABLE.test(mimeType)) return shareFile(name, mimeType, data);
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
