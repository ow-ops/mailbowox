import { Linking } from 'react-native';

import { getAccounts } from '@/accounts/store';
import { core, type Draft, type MessageBody } from '@/core';

import { replySender } from './from';
import { holdMessage, releaseMessage } from './outbox';
import type { StoredItem } from './refs';

export type UnsubscribeMethod =
  | { kind: 'oneClick'; url: string }
  | { kind: 'mail'; to: string; subject: string; text: string }
  | { kind: 'web'; url: string };

function mailto(url: string): UnsubscribeMethod | undefined {
  const [address, query = ''] = url.slice('mailto:'.length).split('?', 2);
  const to = decodeURIComponent(address.split(',')[0]).trim();
  if (!to.includes('@')) return undefined;
  const params = new Map(
    query
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const [name, value = ''] = pair.split('=', 2);
        return [name.toLowerCase(), decodeURIComponent(value.replace(/\+/g, ' '))] as const;
      }),
  );
  return { kind: 'mail', to, subject: params.get('subject') || 'unsubscribe', text: params.get('body') ?? '' };
}

// In the order they are tried: one click when the list offers it (RFC 8058), then a mail to the list, then its
// web page, which only the user can finish.
export function unsubscribeMethods(body: Pick<MessageBody, 'listUnsubscribe' | 'listUnsubscribeOneClick'>) {
  const https = body.listUnsubscribe.find((url) => /^https:/i.test(url));
  const mail = body.listUnsubscribe.filter((url) => /^mailto:/i.test(url)).map(mailto)[0];
  const methods: UnsubscribeMethod[] = [];
  if (https && body.listUnsubscribeOneClick) methods.push({ kind: 'oneClick', url: https });
  if (mail) methods.push(mail);
  if (https) methods.push({ kind: 'web', url: https });
  return methods;
}

async function sendUnsubscribe(item: StoredItem, method: Extract<UnsubscribeMethod, { kind: 'mail' }>) {
  const from = replySender(getAccounts(), item.summary, item.account);
  const draft: Draft = {
    from: from.address,
    to: [{ email: method.to }],
    cc: [],
    bcc: [],
    subject: method.subject,
    text: method.text,
    references: [],
    attachments: [],
  };
  await releaseMessage(await holdMessage(from.account, draft));
}

// 'done' once the list has the request; 'opened' when its page is left for the user to finish.
export async function unsubscribe(item: StoredItem, methods: UnsubscribeMethod[]): Promise<'done' | 'opened'> {
  let failure: unknown;
  for (const method of methods) {
    try {
      if (method.kind === 'oneClick') await core.unsubscribeOneClick(method.url);
      else if (method.kind === 'mail') await sendUnsubscribe(item, method);
      else {
        await Linking.openURL(method.url);
        return 'opened';
      }
      return 'done';
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
