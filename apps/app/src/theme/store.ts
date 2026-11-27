import { colord, extend } from 'colord';
import mixPlugin from 'colord/plugins/mix';
import { randomUUID } from 'expo-crypto';
import { Appearance, Platform } from 'react-native';
import * as v from 'valibot';
import { createStore } from 'zustand';

import { Colors, type ThemeColor } from '@/constants/theme';
import { readItem, writeItem } from '@/utils/kv';
import { readJson } from '@/utils/stored';

import { parseThemeFile, type ThemeFile, type ThemeFileError, type ThemeKind } from './theme-file';

extend([mixPlugin]);

export const APPEARANCES = ['system', 'light', 'dark'] as const;

export type AppearanceSetting = (typeof APPEARANCES)[number];

const kindSchema = v.picklist(['light', 'dark']);
// null is the built-in theme.
const choice = v.nullable(v.string());

// The file text is the source of truth: it is what gets shared, exported and refreshed from the catalog.
const themeSchema = v.looseObject({ id: v.string(), name: v.string(), kind: kindSchema, css: v.string(), source: v.optional(v.string()) });
const tweakSchema = v.looseObject({
  id: v.string(),
  name: v.string(),
  css: v.string(),
  enabled: v.boolean(),
  source: v.optional(v.string()),
});

// Loose objects, as in the vault document: a field a newer app added survives a sync through this one.
export const themeStateSchema = v.looseObject({
  appearance: v.fallback(v.picklist(APPEARANCES), 'system'),
  themes: v.optional(v.array(themeSchema), []),
  tweaks: v.optional(v.array(tweakSchema), []),
  selected: v.optional(v.looseObject({ light: v.optional(choice, null), dark: v.optional(choice, null) }), {}),
  // By lowercased account email, so every device shows an account in its own theme. A kind left out follows the app.
  byAccount: v.optional(v.record(v.string(), v.looseObject({ light: v.optional(choice), dark: v.optional(choice) })), {}),
});

export type ThemeState = v.InferOutput<typeof themeStateSchema>;
export type CustomTheme = v.InferOutput<typeof themeSchema>;
type ThemeChoice = Record<ThemeKind, string | null>;
type AccountThemeChoice = ThemeState['byAccount'][string];

const KEY = 'themes';
const UPDATED_KEY = 'themes.updatedAt';

const DEFAULTS: ThemeState = v.parse(themeStateSchema, {});

export const themeStore = createStore<ThemeState>(() => readJson(KEY, themeStateSchema, DEFAULTS));

function applyAppearance({ appearance }: ThemeState) {
  if (Platform.OS !== 'web') Appearance.setColorScheme(appearance === 'system' ? 'auto' : appearance);
}
applyAppearance(themeStore.getState());

themeStore.subscribe((state) => {
  writeItem(KEY, JSON.stringify(state));
  applyAppearance(state);
});

// Every change made here is newer than the vault's copy; restoreThemes is the one write that is not.
function set(next: Partial<ThemeState>) {
  writeItem(UPDATED_KEY, String(Date.now()));
  themeStore.setState(next);
}

export const getSyncedThemes = () => ({ updatedAt: Number(readItem(UPDATED_KEY) ?? 0), value: themeStore.getState() });

export function restoreThemes(value: ThemeState, updatedAt: number) {
  writeItem(UPDATED_KEY, String(updatedAt));
  themeStore.setState({ ...DEFAULTS, ...value }, true);
}

// A file from a URL that is already installed replaces that copy.
export function installThemeFile(css: string, fallbackName: string, source?: string): ThemeFileError | null {
  const file = parseThemeFile(css);
  if (typeof file === 'string') return file;
  const state = themeStore.getState();
  const name = file.meta.name ?? fallbackName;
  if (file.type === 'theme') {
    const existing = source ? state.themes.find((t) => t.source === source) : undefined;
    saveTheme({ id: existing?.id ?? randomUUID(), name, kind: file.meta.kind ?? 'light', css, source });
  } else {
    const existing = source ? state.tweaks.find((t) => t.source === source) : undefined;
    const tweak = { id: existing?.id ?? randomUUID(), name, css, enabled: existing?.enabled ?? true, source };
    set({ tweaks: [...state.tweaks.filter((t) => t.id !== tweak.id), tweak] });
  }
  return null;
}

// Unsets the kinds an account can no longer use, and drops accounts left with nothing of their own.
function withoutChoices(byAccount: ThemeState['byAccount'], invalid: (kind: ThemeKind, id: string | null) => boolean) {
  return Object.fromEntries(
    Object.entries(byAccount).flatMap(([account, chosen]) => {
      const kept = Object.fromEntries(
        Object.entries(chosen).filter(([kind, id]) => id !== undefined && !invalid(kind as ThemeKind, id as string | null)),
      );
      return Object.keys(kept).length ? [[account, kept]] : [];
    }),
  );
}

export function saveTheme(theme: CustomTheme) {
  const state = themeStore.getState();
  const exists = state.themes.some((t) => t.id === theme.id);
  // A theme moved to the other kind can no longer fill its old slot.
  const misplaced = (kind: ThemeKind) => kind !== theme.kind;
  const selected = { ...state.selected };
  for (const kind of ['light', 'dark'] as const) {
    if (selected[kind] === theme.id && misplaced(kind)) selected[kind] = null;
  }
  set({
    themes: exists ? state.themes.map((t) => (t.id === theme.id ? theme : t)) : [...state.themes, theme],
    selected,
    byAccount: withoutChoices(state.byAccount, (kind, id) => id === theme.id && misplaced(kind)),
  });
}

export function removeTheme(id: string) {
  const state = themeStore.getState();
  const selected = { ...state.selected };
  for (const kind of ['light', 'dark'] as const) if (selected[kind] === id) selected[kind] = null;
  set({
    themes: state.themes.filter((t) => t.id !== id),
    selected,
    byAccount: withoutChoices(state.byAccount, (_, chosen) => chosen === id),
  });
}

export const selectTheme = (kind: ThemeKind, id: string | null) =>
  set({ selected: { ...themeStore.getState().selected, [kind]: id } });

function choiceFor(state: ThemeState, account: string | null | undefined): ThemeChoice {
  const own = (account && state.byAccount[account]) || {};
  const app = { light: state.selected.light ?? null, dark: state.selected.dark ?? null };
  return { light: own.light !== undefined ? own.light : app.light, dark: own.dark !== undefined ? own.dark : app.dark };
}

const family = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase();

// Themes named alike, such as Catppuccin Latte and Catppuccin Mocha, are taken as one family's light and dark.
function partnerOf(themes: CustomTheme[], id: string, kind: ThemeKind) {
  const picked = themes.find((t) => t.id === id);
  return picked && themes.find((t) => t.kind === kind && family(t.name) === family(picked.name))?.id;
}

// `undefined` goes back to the app's theme. An account's first pick also takes the same family's other kind.
export function selectAccountTheme(account: string, kind: ThemeKind, id: string | null | undefined) {
  const state = themeStore.getState();
  const other: ThemeKind = kind === 'light' ? 'dark' : 'light';
  const partner = !state.byAccount[account] && id ? partnerOf(state.themes, id, other) : undefined;
  const next: AccountThemeChoice = { ...state.byAccount[account], ...(partner && { [other]: partner }), [kind]: id };
  if (id === undefined) delete next[kind];
  const { [account]: _, ...rest } = state.byAccount;
  set({ byAccount: Object.keys(next).length ? { ...rest, [account]: next } : rest });
}

export function clearAccountTheme(account: string) {
  const { [account]: _, ...rest } = themeStore.getState().byAccount;
  set({ byAccount: rest });
}

export const setAppearance = (appearance: AppearanceSetting) => set({ appearance });

export const setTweakEnabled = (id: string, enabled: boolean) =>
  set({ tweaks: themeStore.getState().tweaks.map((t) => (t.id === id ? { ...t, enabled } : t)) });

export const removeTweak = (id: string) => set({ tweaks: themeStore.getState().tweaks.filter((t) => t.id !== id) });

// Parsing is cached by file text, so resolving a palette stays cheap on every render.
const parsed = new Map<string, ThemeFile | null>();
function fileOf(css: string) {
  if (!parsed.has(css)) {
    const file = parseThemeFile(css);
    parsed.set(css, typeof file === 'string' ? null : file);
  }
  return parsed.get(css) ?? null;
}

export type Palette = Record<ThemeColor, string>;

const mix = (from: string, to: string, ratio: number) => colord(from).mix(to, ratio).toHex();

// mailbowox colors that sowocial's theme files don't carry, worked out from those they do. Each is only worked out
// when a file changed one of the colors it comes from, so the built-in palette stays as designed.
const DERIVED: { token: ThemeColor; from: ThemeColor[]; make: (p: Palette, kind: ThemeKind) => string }[] = [
  {
    token: 'field',
    from: ['page', 'surface'],
    make: (p, kind) => (kind === 'dark' ? mix(p.page, p.surface, 0.5) : mix(p.page, '#ffffff', 0.7)),
  },
  { token: 'accentSoft', from: ['page', 'primary'], make: (p, kind) => mix(p.page, p.primary, kind === 'dark' ? 0.22 : 0.14) },
  { token: 'onAccentSoft', from: ['heading'], make: (p) => p.heading },
];

// Built-in colors, then each file that applies to this kind in order, then the derived colors no file set.
function layer(kind: ThemeKind, files: (ThemeFile | null)[]): Palette {
  const palette: Palette = { ...Colors[kind] };
  const changed = new Set<ThemeColor>();
  for (const file of files) {
    if (!file || (file.type === 'tweak' && file.meta.kind && file.meta.kind !== kind)) continue;
    Object.assign(palette, file.tokens);
    for (const token of Object.keys(file.tokens) as ThemeColor[]) changed.add(token);
  }
  for (const { token, from, make } of DERIVED) {
    if (!changed.has(token) && from.some((input) => changed.has(input))) palette[token] = make(palette, kind);
  }
  return palette;
}

export const themeColors = (css: string, kind: ThemeKind): Palette => layer(kind, [fileOf(css)]);

const palettes = new WeakMap<ThemeState, Record<string, Palette>>();

export function resolvePalette(current: ThemeState, kind: ThemeKind, account?: string | null): Palette {
  const cached = palettes.get(current) ?? {};
  const slot = `${kind}:${account && current.byAccount[account] ? account : ''}`;
  if (cached[slot]) return cached[slot];
  const theme = current.themes.find((t) => t.id === choiceFor(current, account)[kind]);
  const layers = [theme?.css, ...current.tweaks.filter((t) => t.enabled).map((t) => t.css)];
  const palette = layer(kind, layers.map((css) => (css ? fileOf(css) : null)));
  cached[slot] = palette;
  palettes.set(current, cached);
  return palette;
}
