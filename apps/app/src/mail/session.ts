import { accountConfig, getAccount } from '@/accounts/store';
import { core, type MailSession } from '@/core';

import { keepsConnection } from '@/core/errors';

const sessions = new Map<string, Promise<MailSession>>();

function forget(accountId: string, session: Promise<MailSession>) {
  if (sessions.get(accountId) === session) sessions.delete(accountId);
}

function connect(accountId: string) {
  const session = accountConfig(getAccount(accountId)).then((config) => core.connect(config));
  sessions.set(accountId, session);
  session.catch(() => forget(accountId, session));
  return session;
}

// One shared connection per account for commands; the sync watcher holds its own for IDLE.
export async function withSession<T>(accountId: string, run: (session: MailSession) => Promise<T>) {
  const session = sessions.get(accountId) ?? connect(accountId);
  try {
    return await run(await session);
  } catch (error) {
    if (!keepsConnection(error)) forget(accountId, session);
    throw error;
  }
}

export async function closeSession(accountId: string) {
  const session = sessions.get(accountId);
  if (!session) return;
  sessions.delete(accountId);
  // The connection may already be gone; there is nothing left to close then.
  await session.then((s) => s.logout()).catch(() => {});
}
