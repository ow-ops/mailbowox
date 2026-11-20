import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText, textStyles } from '@/components/themed-text';
import { useContactAddresses } from '@/contacts/queries';
import { suggest } from '@/contacts/suggest';
import type { Address } from '@/core';
import { frameless, Hairline, Press, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addressName, isEmail, parseAddresses, type Recipients } from '@/mail/address';
import { useSeenAddresses } from '@/mail/queries';

// What the user has typed but not yet turned into a chip still counts as recipients.

export const emptyRecipients = (list: Address[] = []): Recipients => ({ list, text: '' });

export const allRecipients = ({ list, text }: Recipients) => [...list, ...parseAddresses(text)];

type Props = { label: string; value: Recipients; onChange: (value: Recipients) => void; autoFocus?: boolean };

export function AddressField({ label, value, onChange, autoFocus }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const commit = (text: string) => onChange({ list: allRecipients({ list: value.list, text }), text: '' });
  const contacts = useContactAddresses().data;
  const seen = useSeenAddresses().data;
  const suggestions = suggest(value.text, contacts ?? [], seen ?? [], value.list);
  // On web the field blurs as a suggestion is pressed, which would turn the half-typed text into a recipient
  // before the press completes.
  const picking = useRef(false);

  return (
    <>
      <View style={[styles.field, { borderBottomColor: theme.border }]}>
        <ThemedText type="meta" style={styles.label}>
          {label}
        </ThemedText>
        <View style={styles.chips}>
          {value.list.map((address, index) => {
            const valid = isEmail(address.email);
            return (
              <Pressable
                key={`${address.email}-${index}`}
                hitSlop={6}
                onPress={() => onChange({ ...value, list: value.list.filter((_, i) => i !== index) })}
                accessibilityRole="button"
                accessibilityLabel={t(valid ? 'compose.removeRecipient' : 'compose.removeInvalidRecipient', {
                  email: address.email,
                })}
                style={({ pressed }) => [
                  styles.chip,
                  valid ? { backgroundColor: theme.surface } : { borderColor: theme.danger },
                  pressed && { opacity: Press.opacity },
                ]}>
                <ThemedText type="labelSmall" themeColor={valid ? 'heading' : 'danger'} numberOfLines={1}>
                  {addressName(address)}
                </ThemedText>
              </Pressable>
            );
          })}
          <TextInput
            value={value.text}
            onChangeText={(text) => (/[,;\n]/.test(text) ? commit(text) : onChange({ ...value, text }))}
            onSubmitEditing={() => commit(value.text)}
            onBlur={() => {
              if (!picking.current) commit(value.text);
            }}
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === 'Backspace' && value.text === '' && value.list.length > 0) {
                onChange({ ...value, list: value.list.slice(0, -1) });
              }
            }}
            autoFocus={autoFocus}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            submitBehavior="submit"
            accessibilityLabel={label}
            selectionColor={theme.primary}
            style={[styles.input, { color: theme.heading }, frameless]}
          />
        </View>
      </View>
      {suggestions.map((address) => (
        <Pressable
          key={address.email}
          onPressIn={() => {
            picking.current = true;
          }}
          onPressOut={() => {
            picking.current = false;
          }}
          onPress={() => onChange({ list: [...value.list, address], text: '' })}
          accessibilityRole="button"
          accessibilityLabel={t('compose.addRecipient', { name: addressName(address), email: address.email })}
          style={({ pressed }) => [
            styles.suggestion,
            { borderBottomColor: theme.border, backgroundColor: pressed ? theme.surface : theme.page },
          ]}>
          {!!address.name && (
            <ThemedText type="label" numberOfLines={1}>
              {address.name}
            </ThemedText>
          )}
          <ThemedText type="meta" numberOfLines={1}>
            {address.email}
          </ThemedText>
        </Pressable>
      ))}
    </>
  );
}

const CHIP_HEIGHT = 32;

const styles = StyleSheet.create({
  // Chips and the input share one row height, so a wrapped field grows by whole rows and ends with its last one.
  field: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    minHeight: TouchTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: Hairline,
  },
  label: {
    minWidth: 56,
    lineHeight: CHIP_HEIGHT,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  chip: {
    maxWidth: '100%',
    minHeight: CHIP_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two + Spacing.half,
    borderWidth: Hairline,
    borderColor: 'transparent',
    borderRadius: Radius.sm,
  },
  suggestion: {
    minHeight: TouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderBottomWidth: Hairline,
  },
  input: {
    ...textStyles.input,
    flexGrow: 1,
    minWidth: 120,
    height: CHIP_HEIGHT,
  },
});
