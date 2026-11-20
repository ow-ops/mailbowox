import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';

import { useAccounts } from '@/accounts/store';

export default function Index() {
  const signedIn = useAccounts().length > 0;
  // The root anchor already put the tabs under this route. A Redirect would stack a second copy,
  // so back from Mail would land on it instead of leaving the app.
  useEffect(() => {
    if (signedIn) router.dismissTo('/mail');
  }, [signedIn]);
  return signedIn ? null : <Redirect href="/add-account" />;
}
