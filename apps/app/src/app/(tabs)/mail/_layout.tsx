import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useStackOptions } from '@/hooks/use-stack-options';

export default function MailLayout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: Platform.OS !== 'web' }} />
    </Stack>
  );
}
