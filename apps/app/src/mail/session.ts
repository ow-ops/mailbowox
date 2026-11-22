import { AppState, Platform } from 'react-native';

import { accountConfig, getAccount } from '@/accounts/store';
import { core, type MailSession } from '@/core';

import { keepsConnection } from '@/core/errors';

const sessions = new Map<string, Promise<MailSession>>();
// One call can take several steps, so a session is only logged out once its calls settle.
const inUse = new WeakMap<Promise<MailSession>, Promise<unknown>>();

function forget(accountId: string, session: Promise<MailSession>) {
  if (sessions.get(accountId) === session) sessions.delete(accountId);
}

// iOS cuts a suspended app's sockets. Replaced on the next call, as other 'active' listeners may run before ours.
let wasInBackground = false;
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'background') wasInBackground = true;
  });
}

function replaceSuspended() {
  if (!wasInBackground || AppState.currentState !== 'active') return;
  wasInBackground = false;
  for (const accountId of sessions.keys()) void closeSession(accountId);
}

function connect(accountId: string) {
  const session = accountConfig(getAccount(accountId)).then((config) => core.connect(config));
  sessions.set(accountId, session);
  session.catch(() => forget(accountId, session));
  return session;
}

// One shared connection per account for commands; the sync watcher holds its own for IDLE.
export async function withSession<T>(accountId: string, run: (session: MailSession) => Promise<T>) {
  replaceSuspended();
  const session = sessions.get(accountId) ?? connect(accountId);
  const result = session.then(run);
  inUse.set(session, Promise.allSettled([inUse.get(session), result]).then(() => {}));
  try {
    return await result;
  } catch (error) {
    if (!keepsConnection(error)) forget(accountId, session);
    throw error;
  }
}

export async function closeSession(accountId: string) {
  const session = sessions.get(accountId);
  if (!session) return;
  sessions.delete(accountId);
  await inUse.get(session);
  // The connection may already be gone; there is nothing left to close then.
  await session.then((s) => s.logout()).catch(() => {});
}
