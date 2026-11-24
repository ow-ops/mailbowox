// Set by the desktop shell (apps/desktop) before the page runs.
type Shell = {
  __TAURI__?: {
    core: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> };
    event: { listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> };
  };
  __MAILBOWOX_RELAY__?: { url: string; token: string };
};

const shell = globalThis as Shell;

export const invoke = shell.__TAURI__?.core.invoke;
export const listen = shell.__TAURI__?.event.listen;
export const localRelay = shell.__MAILBOWOX_RELAY__;
