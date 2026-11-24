// OPFS lets one worker at a time open the files, so a Web Lock keeps them to one tab; another tab waits for it.
const LOCK = 'mailbowox-sql';

export type SqlChannel = { run(request: Uint8Array): Promise<Uint8Array> };

function start(): MessagePort {
  const worker = new Worker(new URL('./sql-worker', window.location.href));
  const channel = new MessageChannel();
  worker.postMessage({ port: channel.port2 }, [channel.port2]);
  return channel.port1;
}

// Replies come in the order of the requests.
function open(): SqlChannel {
  const port = new Promise<MessagePort>((resolve) => {
    if (!navigator.locks) return resolve(start());
    // The callback never settles, so the lock is held until the tab goes away.
    void navigator.locks.request(LOCK, () => new Promise<never>(() => resolve(start())));
  });
  const waiting: ((reply: Uint8Array) => void)[] = [];
  void port.then((ready) => {
    ready.onmessage = ({ data }: MessageEvent<Uint8Array>) => waiting.shift()?.(new Uint8Array(data));
  });
  return {
    run: async (request) => {
      const ready = await port;
      return new Promise((resolve) => {
        waiting.push(resolve);
        const bytes = request.slice();
        ready.postMessage(bytes, [bytes.buffer]);
      });
    },
  };
}

let channel: SqlChannel | undefined;

// One per tab: a second worker in the same tab would wait for the lock the first one holds.
export const sqlChannel = () => (channel ??= open());
