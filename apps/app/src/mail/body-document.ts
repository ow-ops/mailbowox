import { Colors } from '@/constants/theme';
import type { Scheme } from '@/hooks/use-theme';

const REFRESH = /<meta[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi;

// The sanitiser has already removed <style> blocks, so a sender's design shows in its colour attributes.
const DESIGNED = /\s(?:bgcolor|background|color)\s*=|\sstyle\s*=\s*"[^"]*(?:color|background)/i;

// Designed mail keeps the light page it was made for; mail that only sets text takes the app's appearance.
export function bodyScheme(html: string, appScheme: Scheme): Scheme {
  return DESIGNED.test(html) ? 'light' : appScheme;
}

// The CSP is a second fence behind the core's sanitiser: no scripts, frames or remote loads unless allowed.
export function bodyDocument(html: string, allowRemote: boolean, scheme: Scheme) {
  const palette = Colors[scheme];
  const images = allowRemote ? 'data: cid: https: http:' : 'data: cid:';
  const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src ${images}; font-src data:`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>
html { color-scheme: ${scheme}; }
body { margin: 0; padding: 16px; background: ${palette.page}; color: ${palette.text}; font: 16px/1.45 -apple-system, system-ui, Roboto, sans-serif; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { color: ${palette.heading}; }
a { color: ${palette.primary}; }
img { max-width: 100%; height: auto; }
blockquote { margin: 0 0 0 4px; padding-left: 12px; border-left: 1px solid ${palette.outline}; }
pre { white-space: pre-wrap; }
</style>
</head>
<body>${html.replace(REFRESH, '')}</body>
</html>`;
}
