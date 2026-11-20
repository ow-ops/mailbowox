const mockKv = new Map<string, string>();

jest.mock('@sentry/react-native', () => ({ init: jest.fn(), close: jest.fn() }));
jest.mock('@/utils/kv', () => ({
  readItem: (key: string) => mockKv.get(key) ?? null,
  writeItem: (key: string, value: string) => mockKv.set(key, value),
}));

function load(dsn: string | undefined) {
  jest.resetModules();
  if (dsn) process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  else delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  return {
    reports: require('@/crash-reports') as typeof import('@/crash-reports'),
    Sentry: require('@sentry/react-native') as jest.Mocked<typeof import('@sentry/react-native')>,
  };
}

beforeEach(() => {
  mockKv.clear();
});

describe('crash reports', () => {
  it('reports nothing by default', () => {
    const { reports, Sentry } = load('https://key@sentry.example.com/1');
    reports.startCrashReports();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('starts at launch once the switch is on', () => {
    mockKv.set('crashReports', 'on');
    const { reports, Sentry } = load('https://key@sentry.example.com/1');
    reports.startCrashReports();
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ sendDefaultPii: false, attachScreenshot: false }));
  });

  it('stays off at launch when no DSN is set, whatever the switch says', () => {
    mockKv.set('crashReports', 'on');
    const { reports, Sentry } = load(undefined);
    reports.startCrashReports();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(reports.crashReportsAvailable).toBe(false);
  });

  it('starts when switched on and closes when switched off', () => {
    const { reports, Sentry } = load('https://key@sentry.example.com/1');
    reports.setCrashReports(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    reports.setCrashReports(false);
    expect(Sentry.close).toHaveBeenCalledTimes(1);
    expect(mockKv.get('crashReports')).toBe('off');
  });
});
