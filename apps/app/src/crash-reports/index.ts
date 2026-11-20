import * as Sentry from '@sentry/react-native';
import { createStore, useStore } from 'zustand';

import { readItem, writeItem } from '@/utils/kv';

import { scrubBreadcrumb, scrubEvent } from './scrub';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const KEY = 'crashReports';

export const crashReportsAvailable = Boolean(DSN);

const store = createStore<{ on: boolean }>(() => ({ on: readItem(KEY) === 'on' }));

export const useCrashReports = () => useStore(store, (state) => state.on);

function start() {
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoSessionTracking: false,
    enableCaptureFailedRequests: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

export function startCrashReports() {
  if (crashReportsAvailable && store.getState().on) start();
}

export function setCrashReports(on: boolean) {
  writeItem(KEY, on ? 'on' : 'off');
  store.setState({ on });
  if (on) start();
  else void Sentry.close();
}
