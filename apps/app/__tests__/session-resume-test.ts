import { AppState, type AppStateStatus } from 'react-native';

import { core } from '@/core';
import { closeSession, withSession } from '@/mail/session';

jest.mock('@/core', () => ({ core: { connect: jest.fn() } }));
jest.mock('@/accounts/store', () => ({ accountConfig: async () => ({}), getAccount: () => ({}) }));

// The session module listens once, when it loads.
const [[, onChange]] = jest.mocked(AppState.addEventListener).mock.calls;

function moveTo(state: AppStateStatus) {
  AppState.currentState = state;
  onChange(state);
}

let opened: ReturnType<typeof fakeSession>[];

function fakeSession() {
  const session = {
    dead: false,
    listMailboxes: async () => {
      if (session.dead) throw Object.assign(new Error('Broken pipe (os error 32)'), { tag: 'Network' });
      return [];
    },
    logout: jest.fn(async () => undefined),
  };
  return session;
}

const list = () => withSession('a', (session) => session.listMailboxes());

beforeEach(async () => {
  moveTo('active');
  await closeSession('a');
  opened = [];
  jest.mocked(core.connect).mockImplementation(async () => {
    const session = fakeSession();
    opened.push(session);
    return session as never;
  });
});

it('replaces a connection cut while the app was in the background', async () => {
  await list();
  moveTo('background');
  opened[0].dead = true;
  moveTo('active');

  await expect(list()).resolves.toEqual([]);
});

it('replaces a connection opened while the app was in the background', async () => {
  moveTo('background');
  await list();
  opened[0].dead = true;
  moveTo('active');

  await expect(list()).resolves.toEqual([]);
});

it('keeps the connection through an interruption that leaves the app in the foreground', async () => {
  await list();
  moveTo('inactive');
  moveTo('active');

  await list();
  expect(opened).toHaveLength(1);
});

it('logs a replaced connection out once the calls on it are done', async () => {
  await list();
  let finish!: () => void;
  const running = withSession('a', () => new Promise<void>((resolve) => (finish = resolve)));
  await new Promise(setImmediate);
  moveTo('background');
  moveTo('active');
  await list();
  await new Promise(setImmediate);
  expect(opened[0].logout).not.toHaveBeenCalled();

  finish();
  await running;
  await new Promise(setImmediate);
  expect(opened[0].logout).toHaveBeenCalled();
});
