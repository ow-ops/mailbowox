import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { hrefFromParam } from '@/utils/href-param';
import { ContactFormScreen } from '@/components/contact-form';
import { useContact } from '@/contacts/queries';
import { useTheme } from '@/hooks/use-theme';

export default function ContactEditScreen() {
  const { account, href } = useLocalSearchParams<{ account?: string; href?: string }>();
  if (account && href) return <EditContact account={account} href={hrefFromParam(href)} />;
  return <ContactFormScreen />;
}

function EditContact({ account, href }: { account: string; href: string }) {
  const theme = useTheme();
  const { data: item } = useContact({ account, href });
  if (!item) return <ActivityIndicator color={theme.muted} style={{ flex: 1 }} />;
  return <ContactFormScreen item={item} />;
}
