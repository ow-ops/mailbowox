import { store } from '../jest/mail-store';
import { readLocalDraft, removeAccountDrafts, writeLocalDraft, type LocalDraft } from '@/mail/local-drafts';

jest.mock('@/mail/store', () => jest.requireActual('../jest/mail-store'));

jest.mock('@/utils/kv', () => {
  const items = new Map<string, string>();
  return {
    readItem: (key: string) => items.get(key) ?? null,
    writeItem: (key: string, value: string) => items.set(key, value),
  };
});

const draft = (account: string): LocalDraft => ({
  account,
  from: { email: `${account}@example.org` },
  to: { list: [], text: '' },
  cc: { list: [], text: '' },
  bcc: { list: [], text: '' },
  subject: 'Hello',
  text: '',
});

it('drops the drafts of a removed account, with their attachments, and keeps the others', async () => {
  writeLocalDraft('new/', draft('a'));
  writeLocalDraft('reply/a/INBOX/1', draft('a'));
  writeLocalDraft('reply/b/INBOX/1', draft('b'));

  await removeAccountDrafts('a');

  expect(readLocalDraft('new/')).toBeUndefined();
  expect(readLocalDraft('reply/a/INBOX/1')).toBeUndefined();
  expect(readLocalDraft('reply/b/INBOX/1')).toEqual(draft('b'));
  expect(store.setDraftAttachments).toHaveBeenCalledTimes(2);
  expect(store.setDraftAttachments).toHaveBeenCalledWith('new/', []);
  expect(store.setDraftAttachments).toHaveBeenCalledWith('reply/a/INBOX/1', []);
});
