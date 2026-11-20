import { t } from '@/i18n';

import type { Location } from './crypto';

export type StoredBlob = { data: Uint8Array; version: number };

async function request(gateway: string, path: string, init: RequestInit = {}) {
  try {
    return await fetch(`${gateway}${path}`, init);
  } catch {
    throw new Error(t('settings.devices.errors.unreachable', { gateway }));
  }
}

const failed = (response: Response) => new Error(t('settings.devices.errors.gateway', { status: response.status }));

const bearer = (location: Location) => ({ Authorization: `Bearer ${location.auth}` });

// Null when nothing is stored there, 'deleted' when a device deleted what was.
export async function readBlob(gateway: string, location: Location): Promise<StoredBlob | 'deleted' | null> {
  const response = await request(gateway, `/vault/${location.id}`, { headers: bearer(location) });
  if (response.status === 404) return null;
  if (response.status === 410) return 'deleted';
  if (!response.ok) throw failed(response);
  const version = Number(response.headers.get('etag')?.replaceAll('"', ''));
  return { data: new Uint8Array(await response.arrayBuffer()), version };
}

// False when someone else wrote a newer version first.
export async function writeBlob(gateway: string, location: Location, version: number, data: Uint8Array<ArrayBuffer>) {
  const response = await request(gateway, `/vault/${location.id}`, {
    method: 'PUT',
    headers: { ...bearer(location), 'If-Match': `"${version}"` },
    body: data,
  });
  if (response.status === 412) return false;
  if (!response.ok) throw failed(response);
  return true;
}

// Deletes it for every device: the gateway keeps the id as deleted, and answers so from then on.
export async function deleteBlob(gateway: string, location: Location) {
  const response = await request(gateway, `/vault/${location.id}`, { method: 'DELETE', headers: bearer(location) });
  if (!response.ok && response.status !== 404) throw failed(response);
}

export async function postLink(gateway: string, id: string, data: Uint8Array<ArrayBuffer>) {
  const response = await request(gateway, `/link/${id}`, { method: 'POST', body: data });
  if (!response.ok) throw failed(response);
}

export async function takeLink(gateway: string, id: string) {
  const response = await request(gateway, `/link/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw failed(response);
  return new Uint8Array(await response.arrayBuffer());
}
