import { useTranslation } from 'react-i18next';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';
import { bodyDocument, bodyScheme } from '@/mail/body-document';

// No allow-scripts and no allow-same-origin: the frame cannot run code or reach the app. Popups are
// allowed only so links, which the document targets at a new tab, can open outside the sandbox.
export function MailBody({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const { t } = useTranslation();
  const scheme = bodyScheme(html, useScheme());
  return (
    <iframe
      title={t('mail.reader.body')}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={bodyDocument(html, allowRemote, scheme)}
      style={{ flex: 1, width: '100%', border: 0, backgroundColor: Colors[scheme].page }}
    />
  );
}
