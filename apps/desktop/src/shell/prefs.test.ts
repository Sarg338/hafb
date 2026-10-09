import { describe, expect, it } from 'vitest';
import { createPrefsStore, DEFAULT_PREFS, parsePrefs, PREFS_KEY, type KeyValueStorage } from './prefs.ts';

function memory(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('parsePrefs', () => {
  it('defaults for missing or broken data', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[]')).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and drops invalid ones', () => {
    const p = parsePrefs(JSON.stringify({ version: 1, theme: 'dark', sidebarCollapsed: true, inspectorWidth: 'wide', collapsedSections: ['closed', 3] }));
    expect(p.theme).toBe('dark');
    expect(p.sidebarCollapsed).toBe(true);
    expect(p.inspectorWidth).toBe(DEFAULT_PREFS.inspectorWidth);
    expect(p.collapsedSections).toEqual(['closed']);
  });

  it('rejects unknown themes and clamps the inspector width', () => {
    expect(parsePrefs(JSON.stringify({ version: 1, theme: 'neon' })).theme).toBe('system');
    expect(parsePrefs(JSON.stringify({ version: 1, inspectorWidth: 9000 })).inspectorWidth).toBe(480);
    expect(parsePrefs(JSON.stringify({ version: 1, inspectorWidth: 10 })).inspectorWidth).toBe(280);
  });

  it('ignores data from a newer schema version rather than misreading it', () => {
    expect(parsePrefs(JSON.stringify({ version: 99, theme: 'dark' }))).toEqual(DEFAULT_PREFS);
  });

  it('reads the text size (only the offered sizes) and default accounts per plan (S7.1)', () => {
    const p = parsePrefs(JSON.stringify({ version: 1, textScale: 1.25, defaultAccounts: { 'C:/a.hafb': 'acct-1', 'C:/b.hafb': 7 } }));
    expect(p.textScale).toBe(1.25);
    expect(p.defaultAccounts).toEqual({ 'C:/a.hafb': 'acct-1' });
    expect(parsePrefs(JSON.stringify({ version: 1, textScale: 3 })).textScale).toBe(1);
  });

  it('keeps last routes per plan path as strings only', () => {
    const p = parsePrefs(JSON.stringify({ version: 1, lastRoute: { 'C:\\a.hafb': '#/reflect', bad: 4 } }));
    expect(p.lastRoute).toEqual({ 'C:\\a.hafb': '#/reflect' });
  });

  it('reads Plan display options and per-plan collapsed groups', () => {
    expect(DEFAULT_PREFS.showProgressBars).toBe(true);
    expect(DEFAULT_PREFS.hideAmounts).toBe(false);
    const p = parsePrefs(JSON.stringify({ version: 1, showProgressBars: false, hideAmounts: true, collapsedGroups: { 'C:\\a.hafb': ['g1', 3], bad: 'x' } }));
    expect(p.showProgressBars).toBe(false);
    expect(p.hideAmounts).toBe(true);
    expect(p.collapsedGroups).toEqual({ 'C:\\a.hafb': ['g1'] });
  });

  it('reads Reflect filters per plan, dropping bad months and non-string ids', () => {
    const p = parsePrefs(JSON.stringify({ version: 1, reflectFilters: { 'C:/a.hafb': { preset: 'custom', from: '2026-01', to: 'x', excludedCategories: ['c1', 2], excludedAccounts: 'no' }, bad: { preset: 4 } } }));
    expect(p.reflectFilters).toEqual({ 'C:/a.hafb': { preset: 'custom', from: '2026-01', excludedCategories: ['c1'], excludedAccounts: [] } });
  });

  it('reads View Options per register, dropping bad months', () => {
    const p = parsePrefs(JSON.stringify({ version: 1, registerViews: { acc1: { preset: 'custom', from: '2026-01', to: 'nope', showReconciled: false, runningBalance: true }, bad: 3 } }));
    expect(p.registerViews).toEqual({ acc1: { preset: 'custom', from: '2026-01', showReconciled: false, showFlags: true, runningBalance: true } });
  });
});

describe('prefs store', () => {
  it('saves updates and notifies subscribers', () => {
    const storage = memory();
    const store = createPrefsStore(storage);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.update({ theme: 'light' });
    expect(store.get().theme).toBe('light');
    expect(calls).toBe(1);
    expect(JSON.parse(storage.data[PREFS_KEY] ?? '{}')).toMatchObject({ version: 1, theme: 'light' });
  });

  it('works in memory when storage throws (private mode, blocked site data)', () => {
    const store = createPrefsStore(throwing);
    expect(store.get()).toEqual(DEFAULT_PREFS);
    store.update({ sidebarCollapsed: true });
    expect(store.get().sidebarCollapsed).toBe(true);
  });

  it('reads what an earlier session saved', () => {
    const storage = memory({ [PREFS_KEY]: JSON.stringify({ version: 1, theme: 'high-contrast', noColor: true }) });
    expect(createPrefsStore(storage).get()).toMatchObject({ theme: 'high-contrast', noColor: true });
  });

  it('toggles a collapsed section', () => {
    const store = createPrefsStore(memory());
    store.toggleSection('closed');
    expect(store.get().collapsedSections).toEqual(['closed']);
    store.toggleSection('closed');
    expect(store.get().collapsedSections).toEqual([]);
  });
});
