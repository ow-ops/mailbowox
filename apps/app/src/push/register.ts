import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import * as v from 'valibot';

import { accountConfig, type Account } from '@/accounts/store';
import { t } from '@/i18n';
import { removeItem, writeItem } from '@/utils/kv';
import { readJson } from '@/utils/stored';

import { ANDROID_CHANNEL, GATEWAY_URL } from './config';
import { getOrCreatePushKeys } from './keys';

const unregistration = v.object({ id: v.string(), secret: v.string() });
const device = v.object({ platform: v.string(), token: v.string() });

type Device = v.InferOutput<typeof device>;
type Unregistration = v.InferOutput<typeof unregistration>;
type Registration = Device & Unregistration & { keys: boolean };

const key = (accountId: string) => `push.${accountId}`;

const savedRegistration = v.object({ ...device.entries, ...unregistration.entries, keys: v.optional(v.boolean()) });

const saved = (accountId: string) => readJson(key(accountId), savedRegistration, null);

export const isPushOn = (accountId: string) => !!saved(accountId);

async function allowNotifications() {
  if (Platform.OS === 'android') {
    // Android 13+ shows no permission prompt and issues no token until a channel exists.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: t('settings.notifications.channel'),
      importance: AndroidImportance.HIGH,
    });
  }
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error(t('settings.notifications.permissionDenied'));
}

async function currentDevice(): Promise<Device> {
  const { data } = await Notifications.getDevicePushTokenAsync();
  // Development-signed iOS builds get APNs sandbox tokens, which production APNs rejects.
  const platform =
    Platform.OS === 'ios' && (await Application.getIosPushNotificationServiceEnvironmentAsync()) === 'development'
      ? 'ios-sandbox'
      : Platform.OS;
  return { platform, token: String(data) };
}

function gatewayError(status: number) {
  if (status === 401) return new Error(t('settings.notifications.refused'));
  return new Error(t('settings.notifications.failed', { status }));
}

async function deviceKeys() {
  if (Platform.OS !== 'ios') return undefined;
  const { publicKey, auth } = await getOrCreatePushKeys();
  return { p256dh: publicKey, auth };
}

async function register(account: Account, device: Device) {
  const config = await accountConfig(account);
  const keys = await deviceKeys();
  const response = await fetch(`${GATEWAY_URL}/push/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...device,
      email: config.email,
      host: config.imap.host,
      port: config.imap.port,
      security: config.imap.security,
      username: config.credentials.username,
      password: config.credentials.password,
      keys,
    }),
  });
  if (!response.ok) throw gatewayError(response.status);
  const issued = v.safeParse(unregistration, await response.json());
  if (!issued.success) throw gatewayError(response.status);
  const registration: Registration = { ...issued.output, ...device, keys: !!keys };
  writeItem(key(account.id), JSON.stringify(registration));
  return registration;
}

export async function enablePush(account: Account) {
  await allowNotifications();
  await register(account, await currentDevice());
}

async function unregister({ id, secret }: Unregistration) {
  const response = await fetch(`${GATEWAY_URL}/push/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secret}` },
  });
  return response.status;
}

export async function disablePush(account: Account) {
  const registration = saved(account.id);
  if (!registration) return;
  const status = await unregister(registration);
  // 404: the gateway already dropped it, after a refused password or a dead device token.
  if (status >= 300 && status !== 404) throw gatewayError(status);
  removeItem(key(account.id));
}

const PENDING_KEY = 'push.unregister';

const pending = () => readJson(PENDING_KEY, v.array(unregistration), []);

// For an account that is being removed: the gateway may be out of reach, and the account must not stay on
// the device for that. A registration that couldn't be removed is kept and tried again at each start, as
// the gateway holds the account's password for as long as it exists.
export async function dropPush(account: Account) {
  const registration = saved(account.id);
  if (!registration) return;
  try {
    await disablePush(account);
  } catch {
    const { id, secret } = saved(account.id) ?? registration;
    writeItem(PENDING_KEY, JSON.stringify([...pending(), { id, secret }]));
    removeItem(key(account.id));
  }
}

export async function retryUnregistrations() {
  for (const registration of pending()) {
    // A refusal is final. A gateway that could not be reached, failed, timed out or is rate limiting is
    // asked again.
    const status = await unregister(registration).catch(() => 503);
    if (status >= 500 || status === 408 || status === 429) continue;
    writeItem(PENDING_KEY, JSON.stringify(pending().filter((other) => other.id !== registration.id)));
  }
}

// Runs at app start: APNs or FCM can issue a new device token between runs.
export async function syncPush(account: Account) {
  const registration = saved(account.id);
  if (!registration) return;
  const device = await currentDevice();
  const missingKeys = Platform.OS === 'ios' && !registration.keys;
  if (device.token !== registration.token || device.platform !== registration.platform || missingKeys) {
    await register(account, device);
  }
}
