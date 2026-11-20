import { core } from '@/core';
import { getPrefs, setPref } from '@/prefs/store';

// Hosted web builds bake in their own relay, so their users never see the relay step.
export const HOSTED_RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL ?? '';

const CHECK_TIMEOUT = 8000;

export const isRelayUrl = (url: string) => /^https?:\/\/[^\s/]+/i.test(url);

export async function relayReachable(url: string) {
  const base = url.endsWith('/') ? url : `${url}/`;
  try {
    const response = await fetch(new URL('healthz', base), { signal: AbortSignal.timeout(CHECK_TIMEOUT) });
    return response.ok;
  } catch {
    return false;
  }
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
