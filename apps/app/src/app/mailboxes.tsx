import { router } from 'expo-router';

import { MailboxList } from '@/components/mailbox-list';
import { setMailView, useMailView } from '@/mail/view';

export default function MailboxesScreen() {
  return (
    <MailboxList
      current={useMailView()}
      onSelect={(view) => {
        setMailView(view);
        router.back();
      }}
    />
  );
}
