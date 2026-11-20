import { MutationCache, QueryClient } from '@tanstack/react-query';

import { t } from '@/i18n';
import { showError } from '@/utils/toast';

import { explainError } from '@/core/errors';

// Screens that show a mutation's error themselves opt out of the toast with this meta.
export const handlesError = { handlesError: true };

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!mutation.meta?.handlesError) showError(t('common.actionFailed'), explainError(error).summary);
    },
  }),
  // SQLite reads and local writes, including queueing a send, also run offline.
  defaultOptions: {
    queries: { retry: 1, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

export function invalidateMail() {
  for (const root of ['messages', 'message', 'mailboxes', 'search', 'addresses', 'outbox']) queryClient.invalidateQueries({ queryKey: [root] });
}

export function invalidateContacts() {
  queryClient.invalidateQueries({ queryKey: ['contacts'] });
}
