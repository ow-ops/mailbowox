import { useTranslation } from 'react-i18next';

import { useAccounts } from '@/accounts/store';
import { NoData } from '@/components/no-data';
import { useFindContacts } from '@/contacts/actions';

export function NoContacts({ syncing }: { syncing: boolean }) {
  const { t } = useTranslation();
  const missing = useAccounts().filter((account) => !account.carddav);
  const find = useFindContacts(missing);

  return (
    <NoData
      icon={{ ios: 'person.crop.circle', android: 'contacts', web: 'contacts' }}
      title={t('contacts.empty.title')}
      syncing={syncing}
      noneText={t('contacts.empty.none')}
      find={
        missing.length > 0
          ? {
              text: t('contacts.empty.undiscovered'),
              label: t('contacts.find.action'),
              loading: find.isPending,
              onPress: () => find.mutate(),
            }
          : undefined
      }
    />
  );
}
