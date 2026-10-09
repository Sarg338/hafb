// Per-device UI preferences (S3.3): theme, sidebar state, inspector width, last screen per plan.
// They live in the webview's localStorage, not in the plan file (they describe this PC, not the
// budget). Every access is guarded: blocked or broken storage falls back to memory, never throws.
import { useSyncExternalStore } from 'react';
import { isMonth, type Month } from '@hafb/shared';

export type ThemePref = 'system' | 'light' | 'dark' | 'high-contrast';

/** A register's View Options (YNAB keeps them per register). */
export interface RegisterViewPref {
  /** A date preset id, or 'custom' for the From/To months. */
  preset: string;
  from?: Month;
  to?: Month;
  showReconciled: boolean;
  showFlags: boolean;
  runningBalance: boolean;
}

export const DEFAULT_REGISTER_VIEW: RegisterViewPref = { preset: 'all', showReconciled: true, showFlags: true, runningBalance: false };

export interface Prefs {
  version: 1;
  theme: ThemePref;
  /** Differentiate without color (shape and icon carry money state too). */
  noColor: boolean;
  sidebarCollapsed: boolean;
  /** Collapsed account sections in the sidebar ("closed" is collapsed until the user opens it). */
  collapsedSections: string[];
  /** Explicitly expanded sections that are collapsed by default. */
  expandedSections: string[];
  inspectorWidth: number;
  /** Keyboard shortcuts on (CLAUDE.md §6.14 "shortcuts on/off"). */
  shortcutsOn: boolean;
  /** Plan Display Options: target progress bars under category names. */
  showProgressBars: boolean;
  /** Hide Amounts: money is masked everywhere until turned off. */
  hideAmounts: boolean;
  /** View Options per register: account id, or 'all' for All Accounts. */
  registerViews: Record<string, RegisterViewPref>;
  /** Collapsed category groups per plan file path (absent = only Hidden Categories collapsed). */
  collapsedGroups: Record<string, string[]>;
  /** Last route per plan file path, to reopen where the user left off. */
  lastRoute: Record<string, string>;
}

export const INSPECTOR_MIN = 280;
export const INSPECTOR_MAX = 480;
export const INSPECTOR_DEFAULT = 328;
export const PREFS_KEY = 'hafb.prefs';

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  theme: 'system',
  noColor: false,
  sidebarCollapsed: false,
  collapsedSections: [],
  expandedSections: [],
  inspectorWidth: INSPECTOR_DEFAULT,
  shortcutsOn: true,
  showProgressBars: true,
  hideAmounts: false,
  registerViews: {},
  collapsedGroups: {},
  lastRoute: {},
};

const THEMES: readonly ThemePref[] = ['system', 'light', 'dark', 'high-contrast'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Validate stored JSON field by field; anything unusable falls back to its default. */
export function parsePrefs(text: string | null): Prefs {
  if (text === null) return DEFAULT_PREFS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_PREFS;
  }
  if (!isRecord(raw) || raw.version !== 1) return DEFAULT_PREFS;
  const theme = THEMES.find((t) => t === raw.theme) ?? DEFAULT_PREFS.theme;
  const width = typeof raw.inspectorWidth === 'number' && Number.isFinite(raw.inspectorWidth) ? Math.round(raw.inspectorWidth) : INSPECTOR_DEFAULT;
  const lastRoute: Record<string, string> = {};
  if (isRecord(raw.lastRoute)) for (const [k, v] of Object.entries(raw.lastRoute)) if (typeof v === 'string') lastRoute[k] = v;
  const collapsedGroups: Record<string, string[]> = {};
  if (isRecord(raw.collapsedGroups)) for (const [k, v] of Object.entries(raw.collapsedGroups)) if (Array.isArray(v)) collapsedGroups[k] = strings(v);
  const registerViews: Record<string, RegisterViewPref> = {};
  if (isRecord(raw.registerViews)) {
    for (const [k, v] of Object.entries(raw.registerViews)) {
      if (!isRecord(v)) continue;
      registerViews[k] = {
        preset: typeof v.preset === 'string' ? v.preset : DEFAULT_REGISTER_VIEW.preset,
        ...(typeof v.from === 'string' && isMonth(v.from) ? { from: v.from } : {}),
        ...(typeof v.to === 'string' && isMonth(v.to) ? { to: v.to } : {}),
        showReconciled: v.showReconciled !== false,
        showFlags: v.showFlags !== false,
        runningBalance: v.runningBalance === true,
      };
    }
  }
  return {
    version: 1,
    theme,
    noColor: raw.noColor === true,
    sidebarCollapsed: raw.sidebarCollapsed === true,
    collapsedSections: strings(raw.collapsedSections),
    expandedSections: strings(raw.expandedSections),
    inspectorWidth: Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, width)),
    shortcutsOn: raw.shortcutsOn !== false,
    showProgressBars: raw.showProgressBars !== false,
    hideAmounts: raw.hideAmounts === true,
    registerViews,
    collapsedGroups,
    lastRoute,
  };
}

export interface KeyValueStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface PrefsStore {
  get: () => Prefs;
  subscribe: (listener: () => void) => () => void;
  update: (patch: Partial<Omit<Prefs, 'version'>>) => void;
  /** Flip a sidebar section between collapsed and expanded. */
  toggleSection: (id: string, collapsedByDefault?: boolean) => void;
}

export function createPrefsStore(storage: KeyValueStorage | null): PrefsStore {
  let prefs = DEFAULT_PREFS;
  try {
    prefs = parsePrefs(storage?.getItem(PREFS_KEY) ?? null);
  } catch {
    prefs = DEFAULT_PREFS;
  }
  const listeners = new Set<() => void>();
  const save = (): void => {
    try {
      storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable: keep working in memory for this session.
    }
  };
  const update = (patch: Partial<Omit<Prefs, 'version'>>): void => {
    prefs = { ...prefs, ...patch };
    save();
    for (const l of listeners) l();
  };
  return {
    get: () => prefs,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    toggleSection: (id, collapsedByDefault = false) => {
      if (collapsedByDefault) {
        const open = prefs.expandedSections.includes(id);
        update({ expandedSections: open ? prefs.expandedSections.filter((s) => s !== id) : [...prefs.expandedSections, id] });
      } else {
        const closed = prefs.collapsedSections.includes(id);
        update({ collapsedSections: closed ? prefs.collapsedSections.filter((s) => s !== id) : [...prefs.collapsedSections, id] });
      }
    },
  };
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const prefs = createPrefsStore(browserStorage());

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get);
}
