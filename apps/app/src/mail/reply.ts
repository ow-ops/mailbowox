import type { Address, AttachmentInfo, MessageBody, MessageSummary } from '@/core';

import { sameAddress } from './address';
import { quotedHtml, signatureText } from './rich';

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

export type Prefill = {
  to: Address[];
  cc: Address[];
  subject: string;
  text: string;
  // The same as `text`, keeping the original's formatting.
  html: string;
  inReplyTo?: string;
  references: string[];
  // Forwarded from the original; the composer downloads them.
  attachments: AttachmentInfo[];
};

export function prefixSubject(subject: string, mode: ReplyMode) {
  if (mode === 'forward') return /^\s*fwd?\s*:/i.test(subject) ? subject : `Fwd: ${subject}`;
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function quote(text: string) {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => (line === '' ? '>' : line.startsWith('>') ? `>${line}` : `> ${line}`))
    .join('\n');
}

function unique(addresses: Address[]) {
  return addresses.filter((address, index) => addresses.findIndex((other) => sameAddress(address, other)) === index);
}

// `header` is the localized attribution line, or the forwarded-message block, placed above the original text.
export function replyPrefill(
  original: MessageSummary,
  body: MessageBody,
  mode: ReplyMode,
  own: Address[],
  header: string,
): Prefill {
  const subject = prefixSubject(original.subject, mode);
  const text = body.text ?? '';
  if (mode === 'forward') {
    const attachments = body.attachments.filter((a) => !a.inline);
    return {
      to: [],
      cc: [],
      subject,
      text: `\n\n${header}\n\n${text}`,
      html: quotedHtml(header, body, false),
      references: [],
      attachments,
    };
  }

  // `own` is every address of the replying account, so a mail to it and to one of its aliases keeps neither. Your
  // other accounts stay in: replying from one to another is still a message to someone.
  const notSelf = (address: Address) => !own.some((mine) => sameAddress(address, mine));
  // Reply-To is where the sender asks for answers: a list, or a desk behind a no-reply address.
  const sender = original.replyTo.length > 0 ? original.replyTo : original.from;
  const others = unique([...sender, ...(mode === 'replyAll' ? original.to : [])].filter(notSelf));
  // Replying to a message you sent goes back to its recipients.
  const to = others.length > 0 ? others : original.to;
  const cc =
    mode === 'replyAll' ? unique(original.cc.filter(notSelf)).filter((a) => !to.some((b) => sameAddress(a, b))) : [];
  const { messageId } = original;
  return {
    to,
    cc,
    subject,
    text: `\n\n${header}\n${quote(text)}`,
    html: quotedHtml(header, body, true),
    inReplyTo: messageId,
    references: messageId ? [...original.references, messageId] : original.references,
    attachments: [],
  };
}

// The line "-- " is what mail clients take for the start of a signature.
const block = (signature: string) => (signature ? `\n\n-- \n${signatureText(signature)}` : '');

// `quoted` is the text a reply or forward starts with; the signature goes above it, where the typing happens.
export const sign = (quoted: string, signature = '') => block(signature) + quoted;
