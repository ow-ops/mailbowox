import { router, useLocalSearchParams } from 'expo-router';

import { MessageReader } from '@/components/message-reader';

export default function MessageScreen() {
  const { account, mailbox, uid, uidValidity } = useLocalSearchParams<{
    account: string; mailbox: string; uid: string; uidValidity?: string;
  }>();
  return <MessageReader message={{ account, mailbox, uid: Number(uid), uidValidity: Number(uidValidity ?? 0) }} onClose={() => router.back()} />;
}
