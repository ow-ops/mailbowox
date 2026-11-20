import { uniffiInitAsync as open } from './generated-web';

export * from './generated-web/mailbowox_core';

// Metro serves the module as an asset, and on web requiring an asset gives its URL.
export function uniffiInitAsync(): Promise<void> {
  return open(require('./generated-web/mailbowox_core.wasm'));
}
