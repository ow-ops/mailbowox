import * as v from 'valibot';

import type { Recipients } from './address';
import type { Address, DraftAttachment } from '@/core';
import { writeItem } from '@/utils/kv';
import { readJson } from '@/utils/stored';

import { mailStore } from './store';

// What the composer holds, kept on this device until sent, saved to the server or discarded. Attachments
// live apart in the mail database and are written only when they change; their bytes are too big to rewrite
// on every keystroke.
export type LocalDraft = {
  account: string;
  from: Address;
  to: Recipients;
  cc: Recipients;
  bcc: Recipients;
  subject: string;
  text: string;
  // Missing in drafts kept before the editor.
  html?: string;
};

type Returned = { draft: LocalDraft; attachments: DraftAttachment[] };

// A message taken back after Send, on its way to the composer that opens for its slot.
let returned: (Returned & { slot: string }) | undefined;

export function handBack(slot: string, draft: LocalDraft, attachments: DraftAttachment[]) {
  returned = { slot, draft, attachments };
}

export function takeBack(slot: string): Returned | undefined {
  if (returned?.slot !== slot) return undefined;
  const { draft, attachments } = returned;
  returned = undefined;
  return { draft, attachments };
}

const KEY = 'compose.drafts';

const drafts = v.record(
  v.string(),
  v.custom<LocalDraft>((draft) => typeof draft === 'object' && draft !== null),
);

const readAll = (): Record<string, LocalDraft> => readJson(KEY, drafts, {});

const writeAll = (drafts: Record<string, LocalDraft>) => writeItem(KEY, JSON.stringify(drafts));

export const readLocalDraft = (slot: string): LocalDraft | undefined => readAll()[slot];

export const writeLocalDraft = (slot: string, draft: LocalDraft) => writeAll({ ...readAll(), [slot]: draft });

export async function removeLocalDraft(slot: string) {
  const { [slot]: _, ...rest } = readAll();
  writeAll(rest);
  await (await mailStore()).setDraftAttachments(slot, []);
}

export async function removeAccountDrafts(account: string) {
  const drafts = Object.entries(readAll());
  writeAll(Object.fromEntries(drafts.filter(([, draft]) => draft.account !== account)));
  for (const [slot] of drafts.filter(([, draft]) => draft.account === account)) await (await mailStore()).setDraftAttachments(slot, []);
}
