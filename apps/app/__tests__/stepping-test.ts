import { indexOf, replacement, type Entry } from '@/mail/selection';

const ref = (uid: number) => ({ account: 'a', mailbox: 'INBOX', uidValidity: 1, uid });
const rows = (...uids: number[]): Entry[] => uids.map((uid) => ({ open: ref(uid), holds: [ref(uid)] }));

test('finds the row that holds a message', () => {
  const entries: Entry[] = [{ open: ref(3), holds: [ref(3), ref(1)] }, ...rows(2)];
  expect(indexOf(entries, ref(1))).toBe(0);
  expect(indexOf(entries, ref(2))).toBe(1);
  expect(indexOf(entries, null)).toBe(-1);
});

test('the row below takes the place of a message that left, whether or not the list has dropped it yet', () => {
  expect(replacement(rows(1, 2, 3), ref(2), 1)).toEqual(ref(3));
  expect(replacement(rows(1, 3), ref(2), 1)).toEqual(ref(3));
});

test('the row above takes the place of the last one', () => {
  expect(replacement(rows(1, 2, 3), ref(3), 2)).toEqual(ref(2));
});

test('nothing opens once the list is empty', () => {
  expect(replacement(rows(1), ref(1), 0)).toBeNull();
});
