import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setIdentities, useAccounts, type Account } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { isEmail } from '@/mail/address';

export default function IdentityScreen() {
  const { account: id, email } = useLocalSearchParams<{ account: string; email?: string }>();
  const account = useAccounts().find((a) => a.id === id);
  return account ? <IdentityForm account={account} email={email} /> : null;
}

// `email` names the identity being edited; without it a new one is added.
function IdentityForm({ account, email: editing }: { account: Account; email?: string }) {
  const { t } = useTranslation();
  const identities = account.identities ?? [];
  const current = identities.find((i) => i.email === editing);
  const [email, setEmail] = useState(current?.email ?? '');
  const [name, setName] = useState(current?.name ?? '');

  const others = [account.email, ...identities.filter((i) => i !== current).map((i) => i.email)];
  const taken = others.some((other) => other.toLowerCase() === email.trim().toLowerCase());
  const canSave = isEmail(email.trim()) && !taken;

  const save = () => {
    const identity = name.trim() ? { name: name.trim(), email: email.trim() } : { email: email.trim() };
    setIdentities(account.id, current ? identities.map((i) => (i === current ? identity : i)) : [...identities, identity]);
    router.back();
  };

  const remove = () => {
    setIdentities(account.id, identities.filter((i) => i !== current));
    router.back();
  };

  return (
    <FormScreen>
      <TextField
        value={email}
        onChangeText={setEmail}
        placeholder={t('settings.identity.email')}
        accessibilityLabel={t('settings.identity.email')}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={!current}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      {taken && (
        <ThemedText themeColor="danger" accessibilityLiveRegion="polite">
          {t('settings.identity.duplicate')}
        </ThemedText>
      )}
      <TextField
        value={name}
        onChangeText={setName}
        placeholder={t('settings.identity.name')}
        accessibilityLabel={t('settings.identity.name')}
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        onSubmitEditing={() => canSave && save()}
      />
      <Button label={t('settings.identity.save')} onPress={save} disabled={!canSave} />
      {current && <Button label={t('settings.identity.remove')} variant="outline" destructive onPress={remove} />}
    </FormScreen>
  );
}
