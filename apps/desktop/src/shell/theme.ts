// Theme switching (S3.3): the user's choice, or Windows' light/dark setting, applied as a theme
// (ADR 0003). A Windows contrast theme always wins: the app then uses Windows' own colours.
import { useEffect, useSyncExternalStore } from 'react';
import { BUILT_IN_THEMES, darkTheme, highContrastTheme, lightTheme } from '../theme/themes.ts';
import { applyTheme, type Theme } from '../theme/tokens.ts';
import type { ThemePref } from './prefs.ts';

export interface SystemAppearance {
  dark: boolean;
  /** Windows contrast themes turn on forced colours in WebView2. */
  forcedColors: boolean;
}

export type ThemeId = 'light' | 'dark' | 'high-contrast';

export function resolveThemeId(pref: ThemePref, system: SystemAppearance): ThemeId {
  if (system.forcedColors) return 'high-contrast';
  if (pref === 'system') return system.dark ? 'dark' : 'light';
  return pref;
}

const QUERIES = { dark: '(prefers-color-scheme: dark)', forcedColors: '(forced-colors: active)' };

function readSystem(): SystemAppearance {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return { dark: false, forcedColors: false };
  return { dark: window.matchMedia(QUERIES.dark).matches, forcedColors: window.matchMedia(QUERIES.forcedColors).matches };
}

let cached = readSystem();
const getSystem = (): SystemAppearance => cached;

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const lists = [window.matchMedia(QUERIES.dark), window.matchMedia(QUERIES.forcedColors)];
  const handler = (): void => {
    cached = readSystem();
    onChange();
  };
  for (const l of lists) l.addEventListener('change', handler);
  return () => {
    for (const l of lists) l.removeEventListener('change', handler);
  };
}

/** Windows' appearance, live: changes when the user switches light/dark or a contrast theme. */
export function useSystemAppearance(): SystemAppearance {
  return useSyncExternalStore(subscribe, getSystem);
}

export function themeById(id: ThemeId): Theme {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? (id === 'dark' ? darkTheme : id === 'high-contrast' ? highContrastTheme : lightTheme);
}

/** Resolve and apply the theme whenever the preference or Windows' appearance changes. */
export function useAppliedTheme(pref: ThemePref): Theme {
  const system = useSystemAppearance();
  const theme = themeById(resolveThemeId(pref, system));
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return theme;
}
