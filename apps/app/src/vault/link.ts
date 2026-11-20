import { t } from '@/i18n';

import {
  createKeyPair,
  createOffer,
  joinerSession,
  linkIds,
  offererSession,
  open,
  seal,
  type KeyPair,
  type LinkOffer,
  type LinkSession,
} from './crypto';
import { postLink, takeLink } from './gateway';

// Matches the gateway's rendezvous lifetime.
const LINK_TTL = 2 * 60 * 1000;
const POLL_INTERVAL = 1500;

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

// Null once the link lifetime has passed, or the wait was aborted, without a message.
async function waitForMessage(gateway: string, id: string, signal: AbortSignal) {
  const deadline = Date.now() + LINK_TTL;
  while (!signal.aborted && Date.now() < deadline) {
    const message = await takeLink(gateway, id);
    if (message) return message;
    await delay(POLL_INTERVAL, signal);
  }
  return null;
}

export type Offer = { offer: LinkOffer; keys: KeyPair };

export function startOffer(gateway: string): Offer {
  const keys = createKeyPair();
  return { offer: createOffer(gateway, keys), keys };
}

export async function waitForJoiner({ offer, keys }: Offer, signal: AbortSignal) {
  const joinerKey = await waitForMessage(offer.gateway, linkIds(offer).joiner, signal);
  return joinerKey && offererSession(offer, keys, joinerKey);
}

export const sendVaultKey = (offer: LinkOffer, session: LinkSession, vaultKey: Uint8Array) =>
  postLink(offer.gateway, linkIds(offer).vaultKey, seal(session.key, vaultKey));

export async function answerOffer(offer: LinkOffer) {
  const keys = createKeyPair();
  await postLink(offer.gateway, linkIds(offer).joiner, keys.publicKey);
  return joinerSession(offer, keys);
}

export async function receiveVaultKey(offer: LinkOffer, session: LinkSession, signal: AbortSignal) {
  const sealed = await waitForMessage(offer.gateway, linkIds(offer).vaultKey, signal);
  if (!sealed) throw new Error(t('settings.devices.errors.expired'));
  try {
    return open(session.key, sealed);
  } catch {
    throw new Error(t('settings.devices.errors.decrypt'));
  }
}
