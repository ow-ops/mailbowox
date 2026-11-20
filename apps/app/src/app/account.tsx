import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { forgetAccount } from '@/accounts/forget';
import { accountLabel, ACCOUNT_HUES, HUE_NAMES } from '@/accounts/colors';
import { useAccounts, type Account } from '@/accounts/store';
import { setAccountColor, useAccountHues } from '@/accounts/use-account-color';
import { useFindContacts } from '@/contacts/actions';
import { AccountSwatch } from '@/components/account-mark';
import { NotificationSettings } from '@/components/notification-settings';
import { Row, Section, SettingsScreen } from '@/components/settings';
import { ThemedText } from '@/components/themed-text';
import type { ServerConfig } from '@/core';
import { explainError } from '@/core/errors';
import { confirmAction } from '@/utils/dialog';
import { showError } from '@/utils/toast';
import { recordRemoval } from '@/vault/sync';

export default function AccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAccounts().find((a) => a.id === id);
  return account ? <AccountSettings account={account} /> : null;
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').split('/')[0];

function AccountSettings({ account }: { account: Account }) {
  const { t } = useTranslation();
  const findContacts = useFindContacts([account]);
  const hue = useAccountHues()[account.email.toLowerCase()];
  const several = useAccounts().length > 1;

  const server = ({ host, port, security }: ServerConfig) =>
    t('settings.account.server', { host, port, security: t(`accounts.servers.security.${security}`) });

  const remove = () =>
    confirmAction(t('settings.accounts.removeConfirm', { email: account.email }), t('settings.accounts.remove'), () => {
      router.back();
      recordRemoval(account.email);
      forgetAccount(account).catch((error: unknown) => showError(t('common.actionFailed'), explainError(error).summary));
    });

  return (
    <SettingsScreen title={account.displayName || account.email}>
      <Section>
        {account.displayName ? <Row title={t('settings.account.name')} detail={account.displayName} /> : null}
        <Row title={t('settings.account.email')} detail={account.email} />
      </Section>

      <Section title={t('settings.account.servers')}>
        <Row title={t('accounts.servers.imap')} detail={server(account.imap)} />
        <Row title={t('accounts.servers.smtp')} detail={server(account.smtp)} />
        <Row title={t('accounts.servers.username')} detail={account.username} />
        {account.carddav ? (
          <Row title={t('settings.account.contacts')} detail={hostOf(account.carddav)} />
        ) : (
          <Row
            title={t('contacts.find.action')}
            detail={t('settings.contacts.none')}
            loading={findContacts.isPending}
            onPress={() => findContacts.mutate()}
          />
        )}
      </Section>

      {several && (
        <Section title={t('settings.account.color')}>
          <ThemedText type="meta">{t('settings.account.colorHint', { label: accountLabel(account) })}</ThemedText>
          {ACCOUNT_HUES.map((option) => (
            <Row
              key={option}
              title={t(`settings.account.colors.${HUE_NAMES[option]}`)}
              leading={<AccountSwatch hue={option} />}
              selected={option === hue}
              onPress={() => setAccountColor(account.email, option)}
            />
          ))}
        </Section>
      )}

      <Section title={t('settings.account.identities')}>
        <ThemedText type="meta">{t('settings.account.identitiesHint')}</ThemedText>
        {(account.identities ?? []).map((identity) => (
          <Row
            key={identity.email}
            title={identity.email}
            detail={identity.name}
            chevron
            onPress={() => router.push({ pathname: '/identity', params: { account: account.id, email: identity.email } })}
          />
        ))}
        <Row
          title={t('settings.account.addIdentity')}
          onPress={() => router.push({ pathname: '/identity', params: { account: account.id } })}
        />
      </Section>

      <Section>
        <Row
          title={t('settings.signature.title')}
          detail={account.signature?.split('\n')[0] ?? t('settings.signature.none')}
          chevron
          onPress={() => router.push({ pathname: '/signature', params: { account: account.id } })}
        />
      </Section>

      <NotificationSettings account={account} />

      <Section>
        <Row title={t('settings.accounts.remove')} destructive onPress={remove} />
      </Section>
    </SettingsScreen>
  );
}
