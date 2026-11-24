import type { TFunction } from 'i18next';

import type { MessageBody } from '@/core';
import { fullTime } from '@/utils/time';

import { formatAddress } from './address';
import type { StoredItem } from './refs';

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// The conversation as one page to print, each message under its headers. Bodies are the sanitised ones the
// reader shows, with remote images still blocked: printing doesn't tell senders anything.
export function printDocument(t: TFunction, messages: { item: StoredItem; body: MessageBody }[]) {
  const subject = messages[0]?.item.summary.subject || t('mail.row.noSubject');
  const sections = messages.map(({ item: { summary }, body }) => {
    const lines = [
      summary.from.length ? t('mail.print.from', { list: summary.from.map(formatAddress).join(', ') }) : '',
      summary.to.length ? t('mail.reader.to', { list: summary.to.map(formatAddress).join(', ') }) : '',
      summary.cc.length ? t('mail.reader.cc', { list: summary.cc.map(formatAddress).join(', ') }) : '',
      fullTime(summary.date),
    ].filter(Boolean);
    const content = body.html ?? `<pre>${escape(body.text ?? '')}</pre>`;
    return `<section><header>${lines.map((line) => `<p>${escape(line)}</p>`).join('')}</header>${content}</section>`;
  });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:">
<title>${escape(subject)}</title>
<style>
body { font: 12pt/1.45 -apple-system, system-ui, Roboto, sans-serif; color: #000; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 12pt; }
header { border-bottom: 1px solid #999; margin-bottom: 8pt; padding-bottom: 4pt; }
header p { margin: 0; font-size: 10pt; color: #333; }
section { break-inside: avoid-page; margin-bottom: 18pt; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; font: inherit; }
</style>
</head>
<body><h1>${escape(subject)}</h1>${sections.join('')}</body>
</html>`;
}
