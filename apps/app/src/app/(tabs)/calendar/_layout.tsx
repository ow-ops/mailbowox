import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { useStackOptions } from '@/hooks/use-stack-options';

export default function CalendarLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: Platform.OS !== 'web', title: t('calendar.tab') }} />
    </Stack>
  );
}
