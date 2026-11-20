import { shortcutFor } from '@/hooks/use-shortcuts';

jest.mock('expo-router', () => require('../jest/expo-router'));

const element = (props: object) => props as unknown as EventTarget;
const body = element({ tagName: 'BODY' });
const archive = jest.fn();
const open = jest.fn();
const shortcuts = { e: archive, Enter: open };

const press = (key: string, extra: object = {}) =>
  shortcutFor(
    { key, target: body, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, ...extra },
    shortcuts,
    body,
  );

test('a plain key runs its shortcut', () => {
  expect(press('e')).toBe(archive);
  expect(press('x')).toBeUndefined();
});

test('typing in a field never runs a shortcut', () => {
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
    expect(press('e', { target: element(target) })).toBeUndefined();
  }
});

test('browser and system shortcuts are left alone', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
    expect(press('e', { [modifier]: true })).toBeUndefined();
  }
});

test('Enter presses a focused control instead of running its shortcut', () => {
  expect(press('Enter', { target: element({ tagName: 'DIV' }) })).toBeUndefined();
  expect(press('Enter')).toBe(open);
});
