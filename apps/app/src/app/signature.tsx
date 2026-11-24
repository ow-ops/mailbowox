import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setSignature, useAccounts, type Account } from '@/accounts/store';
import { Button } from '@/components/button';
import { FormScreen } from '@/components/form-screen';
import { FormatBar, RichBody, useRichEditor } from '@/components/rich-body';
import { ThemedText } from '@/components/themed-text';
import { core } from '@/core';
import { signatureHtml } from '@/mail/rich';

export default function SignatureScreen() {
  const { account: id } = useLocalSearchParams<{ account: string }>();
  const account = useAccounts().find((a) => a.id === id);
  return account ? <SignatureForm account={account} /> : null;
}

function SignatureForm({ account }: { account: Account }) {
  const { t } = useTranslation();
  const { editorRef, selectionRef } = useRichEditor();
  const [initial] = useState(() => signatureHtml(account.signature));
  const [html, setHtml] = useState(initial);

  const save = () => {
    setSignature(account.id, core.htmlToText(html).trim() ? html : '');
    router.back();
  };

  return (
    <FormScreen>
      <RichBody
        editorRef={editorRef}
        selectionRef={selectionRef}
        defaultValue={initial}
        label={t('settings.signature.placeholder')}
        autoFocus
        minHeight={120}
        field
        onChange={setHtml}
      />
      <FormatBar editorRef={editorRef} selectionRef={selectionRef} />
      <ThemedText type="meta">{t('settings.signature.hint', { email: account.email })}</ThemedText>
      <Button label={t('settings.signature.save')} onPress={save} />
    </FormScreen>
  );
}
