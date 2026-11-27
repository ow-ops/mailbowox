import { Platform, StyleSheet } from 'react-native';

// Dark values are the ow-ops tokens (ow-ops-site/src/styles/tokens.css); light is derived from the same hues.
// accentSoft is the one lavender fill: what is selected or current, never decoration.
export const Colors = {
  dark: {
    page: '#0c0a14',
    field: '#15111f',
    surface: '#1a1526',
    accentSoft: '#2d2347',
    onAccentSoft: '#e3d9fa',
    border: '#221c2e',
    outline: '#6a6376',
    text: '#c5bfd1',
    heading: '#ece6f0',
    muted: '#9a93a6',
    primary: '#c8b8ec',
    onPrimary: '#0c0a14',
    danger: '#f0a3b5',
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
  light: {
    page: '#f8f6fb',
    field: '#ffffff',
    surface: '#efebf5',
    accentSoft: '#e7def8',
    onAccentSoft: '#41288a',
    border: '#e0d9ea',
    outline: '#867f94',
    text: '#3d364a',
    heading: '#16121f',
    muted: '#675f75',
    primary: '#6b4fb8',
    onPrimary: '#f8f6fb',
    danger: '#a93557',
    scrim: 'rgba(22, 18, 31, 0.4)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.dark;

// Account colors use the primary, success, warning and danger hues.
export const AccountColors = {
  dark: ['#c8b8ec', '#b7d5c7', '#e8c28c', '#f0a3b5'],
  light: ['#6b4fb8', '#245b43', '#805100', '#a93557'],
} as const;

// Embedded by the expo-font config plugin. iOS resolves fonts by PostScript name,
// Android by file name; web loads the same files with useFonts under the file names.
export const Fonts = Platform.select({
  ios: { display: 'BricolageGrotesque-Bold', heading: 'BricolageGrotesque-SemiBold', mono: 'Menlo' },
  default: { display: 'BricolageGrotesque_700Bold', heading: 'BricolageGrotesque_600SemiBold', mono: 'monospace' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  oneHalf: 12,
  three: 16,
  four: 24,
  five: 32,
} as const;

// sm for chips, key caps and checkboxes; md for anything pressed or typed into; lg for sheets and dialogs.
export const Radius = { sm: 6, md: 12, lg: 16 } as const;

export const Hairline = StyleSheet.hairlineWidth;

export const BorderWidth = { hairline: Hairline, input: 1 } as const;

// Edges a color swatch on any page, light or dark.
export const SwatchEdge = 'rgba(127, 127, 127, 0.4)';

export const Shadow = {
  raised: '0 2px 8px rgba(0, 0, 0, 0.2)',
  overlay: '0 4px 12px rgba(0, 0, 0, 0.3)',
} as const;

export const Press = { opacity: 0.7, disabled: 0.4 } as const;

export const TouchTarget = 48;

export const WindowClass = { medium: 600, expanded: 840, rail: 1024 } as const;

export const ColumnWidth = 640;

export const MailboxPaneWidth = 280;

export const ListPaneWidth = 400;

export const MinListPaneWidth = 320;

export const MinSplitHeight = 480;

// Frameless text fields span their row, so the web focus ring (src/theme/browser.css) is drawn inside it.
export const frameless = Platform.select({
  web: { outlineOffset: -2 } as const,
  default: {},
});
