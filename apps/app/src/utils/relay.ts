import { core } from '@/core';
import { getPrefs, setPref } from '@/prefs/store';

// Hosted web builds bake in their own relay, so their users never see the relay step.
export const HOSTED_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL ?? '';

const CHECK_TIMEOUT = 8000;

export const isRelayUrl = (url: string) => /^https?:\/\/[^\s/]+/i.test(url);

const endpoint = (url: string, path: string) => new URL(path, url.endsWith('/') ? url : `${url}/`);

export async function relayReachable(url: string) {
  try {
    const response = await fetch(endpoint(url, 'healthz'), { signal: AbortSignal.timeout(CHECK_TIMEOUT) });
    return response.ok;
  } catch {
    return false;
  }
}

// Only a 401 is a refusal: a gateway without /relay/check fails the request on CORS, and may well take the code.
export async function relayRefusesCode(url: string, token: string) {
  try {
    const response = await fetch(endpoint(url, 'relay/check'), {
      method: 'POST',
      body: token,
      signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    return response.status === 401;
  } catch {
    return false;
  }
}

export async function savedRelayRefusesCode() {
  const { relayUrl, relayToken } = getPrefs();
  return !!relayUrl && (await relayRefusesCode(relayUrl, relayToken));
}

// Hands the saved relay to the core: at start, and when another device's settings arrive.
export function applyRelay() {
  const { relayUrl, relayToken } = getPrefs();
  if (relayUrl) core.configureRelay(relayUrl, relayToken);
}

export function saveRelay(url: string, token: string) {
  core.configureRelay(url, token);
  setPref('relayUrl', url);
  setPref('relayToken', token);
}
