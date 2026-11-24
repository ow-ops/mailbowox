import type { Draft, DraftAttachment, OutgoingAttachment, QueuedMessage } from '@/core';

// The outbox and draft attachments of the core's store, in memory, for tests of the code around them.
let next = 1;
const queue = new Map<number, QueuedMessage & { attachments: OutgoingAttachment[] }>();
const drafts = new Map<string, DraftAttachment[]>();

export const store = {
  enqueue: async (account: string, { attachments, ...draft }: Draft, error: string | null) => {
    const id = next++;
    queue.set(id, { id, account, queuedAt: 0, error, draft: { ...draft, attachments: [] }, attachments });
    return id;
  },
  queuedMessages: async () => [...queue.values()].map(({ attachments: _, ...queued }) => queued),
  queuedMessage: async (id: number) => {
    const found = queue.get(id);
    if (!found) return undefined;
    const { attachments: _, ...queued } = found;
    return queued;
  },
  queuedAttachments: async (id: number) => queue.get(id)?.attachments ?? [],
  removeQueued: async (id: number) => void queue.delete(id),
  setQueuedError: async (id: number, error: string | null) => {
    const found = queue.get(id);
    if (found) found.error = error;
  },
  setDraftAttachments: jest.fn(async (slot: string, list: DraftAttachment[]) => void drafts.set(slot, list)),
  draftAttachments: async (slot: string) => drafts.get(slot) ?? [],
  clear: () => {
    queue.clear();
    drafts.clear();
  },
};

export const mailStore = async () => store;
