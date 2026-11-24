import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Button } from '@/components/button';
import { FormHeader } from '@/components/form-header';
import { IconButton } from '@/components/icon-button';
import { MenuPicker } from '@/components/menu-picker';
import { ErrorExplanation } from '@/components/error-explanation';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ColumnWidth, Press, Spacing, TouchTarget } from '@/constants/theme';
import { useSaveContact } from '@/contacts/actions';
import type { StoredContact , ContactValue } from '@/core';
import { kindLabel } from '@/contacts/format';
import { EMAIL_KINDS, newForm, nextKind, PHONE_KINDS, toDraft, toForm, type ContactForm } from '@/contacts/form';
import { useAddressBooks } from '@/contacts/queries';
import { useTheme } from '@/hooks/use-theme';
import { explainError } from '@/core/errors';
import { confirmAction } from '@/utils/dialog';

const bookKey = (book: { account: string; href: string }) => `${book.account}\n${book.href}`;

export function ContactFormScreen({ item }: { item?: StoredContact }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [form, setForm] = useState(() => (item ? toForm(item.contact) : newForm()));
  const [touched, setTouched] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const save = useSaveContact();
  const books = useAddressBooks().data ?? [];
  const writable = books.filter((book) => !book.readOnly);
  const target = item
    ? books.find((book) => book.account === item.account && book.href === item.book)
    : (writable.find((book) => bookKey(book) === chosen) ?? writable[0]);

  const edit = (change: Partial<ContactForm>) => {
    setForm({ ...form, ...change });
    setTouched(true);
    save.reset();
  };

  const draft = toDraft(form);
  const canSave = !!draft.name && !!target;

  const submit = () => {
    if (!target) return;
    save.mutate(
      { account: target.account, book: target.href, draft, contact: item?.contact },
      { onSuccess: () => router.back() },
    );
  };

  const cancel = () => {
    if (!touched) return router.back();
    confirmAction(t('contacts.form.discardTitle'), t('contacts.form.discard'), () => router.back());
  };

  return (
    <>
      <FormHeader
        title={item ? t('contacts.form.edit') : t('contacts.form.new')}
        saveLabel={t('contacts.form.save')}
        canSave={canSave}
        saving={save.isPending}
        onCancel={cancel}
        onSave={submit}
      />
      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.page }}
        contentContainerStyle={styles.scroll}
        bottomOffset={Spacing.three}
        keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <TextField
            value={form.given}
            onChangeText={(given) => edit({ given })}
            placeholder={t('contacts.form.firstName')}
            accessibilityLabel={t('contacts.form.firstName')}
            autoFocus={!item}
            autoCapitalize="words"
            returnKeyType="next"
          />
          <TextField
            value={form.family}
            onChangeText={(family) => edit({ family })}
            placeholder={t('contacts.form.lastName')}
            accessibilityLabel={t('contacts.form.lastName')}
            autoCapitalize="words"
            returnKeyType="next"
          />
          <TextField
            value={form.organization}
            onChangeText={(organization) => edit({ organization })}
            placeholder={t('contacts.form.company')}
            accessibilityLabel={t('contacts.form.company')}
            autoCapitalize="words"
          />

          <Values
            values={form.emails}
            kinds={EMAIL_KINDS}
            placeholder={t('contacts.form.email')}
            addLabel={t('contacts.form.addEmail')}
            keyboardType="email-address"
            onChange={(emails) => edit({ emails })}
          />
          <Values
            values={form.phones}
            kinds={PHONE_KINDS}
            placeholder={t('contacts.form.phone')}
            addLabel={t('contacts.form.addPhone')}
            keyboardType="phone-pad"
            onChange={(phones) => edit({ phones })}
          />

          {!item && writable.length > 1 ? (
            <MenuPicker
              label={t('contacts.form.addressBook')}
              options={writable.map((book) => ({ value: bookKey(book), label: book.name }))}
              value={target ? bookKey(target) : ''}
              onChange={setChosen}
            />
          ) : (
            <ThemedText type="meta">{t('contacts.form.inBook', { name: target?.name })}</ThemedText>
          )}
          {!draft.name && touched && (
            <ThemedText type="meta" accessibilityLiveRegion="polite">
              {t('contacts.form.errors.empty')}
            </ThemedText>
          )}
          {save.isError && (
            <View style={styles.saveError} accessibilityLiveRegion="assertive">
              <ThemedText type="label" themeColor="danger">
                {t('contacts.form.saveFailed')}
              </ThemedText>
              <ErrorExplanation {...explainError(save.error)} />
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>
    </>
  );
}

type ValuesProps = {
  values: ContactValue[];
  kinds: string[];
  placeholder: string;
  addLabel: string;
  keyboardType: 'email-address' | 'phone-pad';
  onChange: (values: ContactValue[]) => void;
};

function Values({ values, kinds, placeholder, addLabel, keyboardType, onChange }: ValuesProps) {
  const { t } = useTranslation();
  const change = (index: number, value: ContactValue) => onChange(values.map((v, i) => (i === index ? value : v)));

  return (
    <View style={styles.values}>
      {values.map((entry, index) => {
        const label = kindLabel(entry.kind) ?? t('contacts.form.noKind');
        return (
          <View key={index} style={styles.value}>
            <Pressable
              onPress={() => change(index, { ...entry, kind: nextKind(kinds, entry.kind) })}
              accessibilityRole="button"
              accessibilityLabel={t('contacts.form.kind', { kind: label })}
              style={({ pressed }) => [styles.kind, pressed && { opacity: Press.opacity }]}>
              <ThemedText type="labelSmall" themeColor="primary">
                {label}
              </ThemedText>
            </Pressable>
            <TextField
              value={entry.value}
              onChangeText={(value) => change(index, { ...entry, value })}
              placeholder={placeholder}
              accessibilityLabel={placeholder}
              keyboardType={keyboardType}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.valueField}
            />
            <IconButton
              icon={{ ios: 'minus.circle', android: 'remove_circle', web: 'remove_circle' }}
              label={t('contacts.form.remove', { value: entry.value || placeholder })}
              onPress={() => onChange(values.filter((_, i) => i !== index))}
            />
          </View>
        );
      })}
      <Button label={addLabel} variant="outline" size="small" onPress={() => onChange([...values, { value: '' }])} />
    </View>
  );
}

const styles = StyleSheet.create({
  saveError: { gap: Spacing.one },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  column: {
    width: '100%',
    maxWidth: ColumnWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  values: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  value: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  kind: {
    minWidth: 64,
    minHeight: TouchTarget,
    justifyContent: 'center',
  },
  valueField: {
    flex: 1,
  },
});
