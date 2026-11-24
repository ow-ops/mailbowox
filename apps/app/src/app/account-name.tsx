import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setDisplayName, useAccounts, type Account } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';

export default function AccountNameScreen() {
  const { account: id } = useLocalSearchParams<{ account: string }>();
  const account = useAccounts().find((a) => a.id === id);
  return account ? <NameForm account={account} /> : null;
}

function NameForm({ account }: { account: Account }) {
  const { t } = useTranslation();
  const [name, setName] = useState(account.displayName);

  const save = () => {
    setDisplayName(account.id, name.trim());
    router.back();
  };

  return (
    <FormScreen>
      <TextField
        value={name}
        onChangeText={setName}
        placeholder={t('settings.accountName.placeholder')}
        accessibilityLabel={t('settings.account.name')}
        autoFocus
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <ThemedText type="meta">{t('settings.accountName.hint', { email: account.email })}</ThemedText>
      <Button label={t('settings.accountName.save')} onPress={save} />
    </FormScreen>
  );
}
