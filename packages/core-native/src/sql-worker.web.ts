import init, { serve } from './generated-web/sql-worker/mailbowox_sql_worker';

// Metro serves the module as an asset, and on web requiring an asset gives its URL.
const wasm: string = require('./generated-web/sql-worker/mailbowox_sql_worker_bg.wasm');

self.onmessage = ({ data }: MessageEvent<{ port: MessagePort }>) => {
  void init({ module_or_path: wasm }).then(() => serve(data.port));
};
