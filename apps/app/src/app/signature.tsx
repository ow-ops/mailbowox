import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { setSignature, useAccounts, type Account } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export default function SignatureScreen() {
  const { account: id } = useLocalSearchParams<{ account: string }>();
  const account = useAccounts().find((a) => a.id === id);
  return account ? <SignatureForm account={account} /> : null;
}

function SignatureForm({ account }: { account: Account }) {
  const { t } = useTranslation();
  const [text, setText] = useState(account.signature ?? '');

  const save = () => {
    setSignature(account.id, text.trim());
    router.back();
  };

  return (
    <FormScreen>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder={t('settings.signature.placeholder')}
        accessibilityLabel={t('settings.signature.title')}
        multiline
        autoFocus
        textAlignVertical="top"
        style={styles.field}
      />
      <ThemedText type="meta">{t('settings.signature.hint', { email: account.email })}</ThemedText>
      <Button label={t('settings.signature.save')} onPress={save} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 120, paddingVertical: Spacing.oneHalf },
});
