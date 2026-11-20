import { getPrefs, getSyncedPrefs, restorePrefs, setPref } from '@/prefs/store';

const mockStore = new Map<string, string>();

jest.mock('@/utils/kv', () => ({
  readItem: (key: string) => mockStore.get(key) ?? null,
  writeItem: (key: string, value: string) => mockStore.set(key, value),
}));

describe('prefs from another device', () => {
  it('replace the local ones but leave the relay of a device that has one', () => {
    setPref('relayUrl', 'https://relay.example');
    setPref('relayToken', 'code');

    // A phone has no relay: what it syncs says nothing about the browser's.
    restorePrefs({ ...getPrefs(), conversations: false, relayUrl: '', relayToken: '' }, 5);

    expect(getPrefs()).toMatchObject({ conversations: false, relayUrl: 'https://relay.example', relayToken: 'code' });
    expect(getSyncedPrefs().updatedAt).toBe(5);
  });

  it('bring a relay to a device that has none, or a newer one', () => {
    restorePrefs({ ...getPrefs(), relayUrl: 'https://other.example', relayToken: 'new' }, 6);

    expect(getPrefs()).toMatchObject({ relayUrl: 'https://other.example', relayToken: 'new' });
  });
});
