import { router, useLocalSearchParams } from 'expo-router';

import { hrefFromParam } from '@/utils/href-param';
import { ContactDetail } from '@/components/contact-detail';

export default function ContactScreen() {
  const { account, href } = useLocalSearchParams<{ account: string; href: string }>();
  return <ContactDetail account={account} href={hrefFromParam(href)} onClose={() => router.back()} />;
}
