import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  useFonts,
} from '@expo-google-fonts/bricolage-grotesque';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  type NativeStackNavigationOptions,
  type Theme,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import '@/i18n';

import { useAccounts } from '@/accounts/store';
import { loadCore } from '@/core';
import { startCrashReports } from '@/crash-reports';
import { ErrorView } from '@/components/error-view';
import { AppToaster } from '@/components/toaster';
import { WebDialog } from '@/components/web-dialog';
import { sweepRemovedAccounts } from '@/accounts/forget';
import { useStackOptions } from '@/hooks/use-stack-options';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { queryClient } from '@/utils/query-client';
import { usePushSync } from '@/push/use-push-sync';
import { usePushTaps } from '@/push/use-push-taps';
import { useBrowserTheme } from '@/theme/browser';
import { applyRelay } from '@/utils/relay';
import { watchVault } from '@/vault/sync';

SplashScreen.preventAutoHideAsync();
startCrashReports();

async function startCore() {
  await loadCore();
  applyRelay();
}

const coreStarted = startCore();

export const unstable_settings = { anchor: '(tabs)' };

export { ErrorView as ErrorBoundary };

const webFonts = Platform.OS === 'web' ? { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } : {};

const sheet: NativeStackNavigationOptions = {
  presentation: 'formSheet',
  sheetAllowedDetents: [0.6, 1],
  sheetGrabberVisible: true,
};

export default function RootLayout() {
  const theme = useTheme();
  const scheme = useScheme();
  const base = scheme === 'light' ? DefaultTheme : DarkTheme;

  // The root view shows behind screens during transitions and the keyboard.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.page);
  }, [theme.page]);

  useBrowserTheme();
  useEffect(watchVault, []);
  useEffect(() => void sweepRemovedAccounts().catch(() => {}), []);

  const navigationTheme: Theme = {
    ...base,
    colors: {
      primary: theme.primary,
      background: theme.page,
      card: theme.page,
      text: theme.heading,
      border: theme.border,
      notification: theme.primary,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.page }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navigationTheme}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <RootStack />
            <AppToaster />
            {Platform.OS === 'web' && <WebDialog />}
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { t } = useTranslation();
  const [fontsLoaded] = useFonts(webFonts);
  const [coreLoaded, setCoreLoaded] = useState(false);
  const [coreError, setCoreError] = useState<unknown>();
  const screenOptions = useStackOptions();
  const signedIn = useAccounts().length > 0;
  usePushTaps(fontsLoaded && signedIn);
  usePushSync(fontsLoaded && signedIn);

  useEffect(() => {
    coreStarted.then(() => setCoreLoaded(true), setCoreError);
  }, []);

  useEffect(() => {
    if (fontsLoaded && coreLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded, coreLoaded]);

  if (coreError) throw coreError;
  if (!fontsLoaded || !coreLoaded) return null;

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="add-account" options={{ headerShown: signedIn, title: t('accounts.add.title') }} />
      <Stack.Screen name="join-device" options={{ title: t('settings.devices.join.title') }} />
      <Stack.Protected guard={signedIn} redirectTo="/add-account">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="message" options={{ title: '' }} />
        <Stack.Screen name="attachment" options={{ title: '' }} />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="mailboxes" options={{ ...sheet, title: t('mail.mailboxes.title') }} />
        <Stack.Screen name="move" options={{ ...sheet, title: t('mail.move.title') }} />
        <Stack.Screen name="contact" options={{ title: '' }} />
        <Stack.Screen name="contact-edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shortcuts" options={{ ...sheet, title: t('mail.shortcuts.title') }} />
        <Stack.Screen name="sync-setup" options={{ title: t('settings.devices.setup.title') }} />
        <Stack.Screen name="link-device" options={{ title: t('settings.devices.link.title') }} />
        <Stack.Screen name="account" />
        <Stack.Screen name="identity" options={{ title: t('settings.identity.title') }} />
        <Stack.Screen name="signature" options={{ title: t('settings.signature.title') }} />
        <Stack.Screen name="account-name" options={{ title: t('settings.account.name') }} />
        <Stack.Screen name="remote-senders" />
        <Stack.Screen name="sync" />
      </Stack.Protected>
    </Stack>
  );
}
