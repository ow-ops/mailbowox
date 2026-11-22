import { Platform } from 'react-native';

import { core } from '@/core';
import { applyRelay, asksForRelay } from '@/utils/relay';

jest.mock('@/core', () => ({ core: { configureRelay: jest.fn() } }));
jest.mock('@/utils/desktop', () => ({ localRelay: { url: 'http://127.0.0.1:4000', token: 'code' } }));
jest.mock('@/prefs/store', () => ({ getPrefs: () => ({ relayUrl: 'https://relay.example', relayToken: 'hosted' }) }));

describe('relay inside the desktop shell', () => {
  it("connects through the shell's relay, not the one a browser synced", () => {
    applyRelay();

    expect(core.configureRelay).toHaveBeenCalledTimes(1);
    expect(core.configureRelay).toHaveBeenCalledWith('http://127.0.0.1:4000', 'code');
  });

  it('asks for no relay', () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'web');

    expect(asksForRelay()).toBe(false);
    platform.restore();
  });
});
