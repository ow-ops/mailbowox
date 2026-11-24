import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrichedTextInputInstance } from 'react-native-enriched-html';

import { setSignature, useAccounts, type Account } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { FormatBar, RichBody } from '@/components/rich-body';
import { ThemedText } from '@/components/themed-text';
import { signatureHtml } from '@/mail/rich';

export default function SignatureScreen() {
  const { account: id } = useLocalSearchParams<{ account: string }>();
  const account = useAccounts().find((a) => a.id === id);
  return account ? <SignatureForm account={account} /> : null;
}

function SignatureForm({ account }: { account: Account }) {
  const { t } = useTranslation();
  const editor = useRef<EnrichedTextInputInstance>(null);
  const [initial] = useState(() => signatureHtml(account.signature));
  const [signature, setSignatureHtml] = useState({ html: initial, text: account.signature ?? '' });

  const save = () => {
    setSignature(account.id, signature.text.trim() ? signature.html : '');
    router.back();
  };

  return (
    <FormScreen>
      <RichBody
        ref={editor}
        defaultValue={initial}
        label={t('settings.signature.placeholder')}
        autoFocus
        minHeight={120}
        onChange={(change) => setSignatureHtml((current) => ({ ...current, ...change }))}
      />
      <FormatBar editor={editor} />
      <ThemedText type="meta">{t('settings.signature.hint', { email: account.email })}</ThemedText>
      <Button label={t('settings.signature.save')} onPress={save} />
    </FormScreen>
  );
}
