import type { AttachmentInfo, MailSession } from '@/core';
import { fetchForwarded } from '@/mail/forward';

const files: Record<number, string> = { 1: 'agenda', 3: 'minutes' };

const mockSession = {
  fetchAttachment: async (_mailbox: string, _uidValidity: number, _uid: number, { index }: AttachmentInfo) => {
    if (!(index in files)) throw new Error('Part not found');
    return new TextEncoder().encode(files[index]).buffer;
  },
};

jest.mock('@/mail/session', () => ({
  withSession: (_account: string, run: (s: Partial<MailSession>) => Promise<unknown>) => run(mockSession),
}));

const info = (index: number): AttachmentInfo => ({
  index,
  filename: `file-${index}.txt`,
  mimeType: 'text/plain',
  size: 10,
  inline: false,
});

describe('fetchForwarded', () => {
  it('downloads every attachment and reports a failed one without dropping the rest', async () => {
    const loaded: [number, string][] = [];
    const failed: [number, string][] = [];
    await fetchForwarded(
      { account: 'a', mailbox: 'INBOX', uidValidity: 1, uid: 7 },
      [info(1), info(2), info(3)],
      (attachment, data) => loaded.push([attachment.index, new TextDecoder().decode(data)]),
      (attachment, error) => failed.push([attachment.index, (error as Error).message]),
    );
    expect(loaded).toEqual([
      [1, 'agenda'],
      [3, 'minutes'],
    ]);
    expect(failed).toEqual([[2, 'Part not found']]);
  });
});
