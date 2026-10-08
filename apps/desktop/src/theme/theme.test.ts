import { describe, expect, it } from 'vitest';
import { contrast } from './contrast.ts';
import { BUILT_IN_THEMES } from './themes.ts';
import { COLOR_TOKENS, cssVar, type ColorToken, type Theme } from './tokens.ts';

// Text pairs need 4.5:1 (WCAG 1.4.3); state graphics and focus need 3:1 against the surface (1.4.11).
const TEXT_PAIRS: [ColorToken, ColorToken][] = [
  ['text', 'surface'],
  ['text', 'surfaceAlt'],
  ['text', 'app'],
  ['text', 'raised'],
  ['text', 'hover'],
  ['selectedText', 'selected'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceAlt'],
  ['textSubtle', 'surface'],
  ['textSubtle', 'surfaceAlt'],
  ['textSubtle', 'raised'],
  ['link', 'surface'],
  ['negative', 'surface'],
  ['negative', 'surfaceAlt'],
  ['sidebarText', 'sidebar'],
  ['sidebarText', 'sidebarHover'],
  ['sidebarText', 'sidebarSelected'],
  ['sidebarMuted', 'sidebar'],
  ['sidebarMuted', 'sidebarSelected'],
  ['textOnAccent', 'accent'],
  ['textOnAccent', 'accentHover'],
  ['fundedFg', 'fundedBg'],
  ['underfundedFg', 'underfundedBg'],
  ['overspentFg', 'overspentBg'],
  ['zeroFg', 'zeroBg'],
  ['rtaPositiveFg', 'rtaPositiveBg'],
  ['rtaZeroFg', 'rtaZeroBg'],
  ['rtaNegativeFg', 'rtaNegativeBg'],
  ['text', 'accentSoft'],
];

const GRAPHIC_PAIRS: [ColorToken, ColorToken][] = [
  ['accent', 'surface'],
  ['focus', 'surface'],
  ['focus', 'surfaceAlt'],
  ['selectedBorder', 'surface'],
  ['inputBorder', 'input'],
  ['barFunded', 'surface'],
  ['barUnderfunded', 'surface'],
  ['barOverspent', 'surface'],
  ['chartIncome', 'surface'],
  ['chartExpense', 'surface'],
];

const computed = BUILT_IN_THEMES.filter((t) => t.system !== true);

describe('built-in themes', () => {
  it.each(BUILT_IN_THEMES.map((t) => [t.id, t] as const))('%s defines every token', (_id, theme: Theme) => {
    for (const token of COLOR_TOKENS) expect(theme.colors[token], token).toBeTruthy();
  });

  it.each(computed.flatMap((t) => TEXT_PAIRS.map(([fg, bg]) => [t.id, fg, bg, t] as const)))(
    '%s: %s on %s is at least 4.5:1',
    (_id, fg, bg, theme) => {
      expect(contrast(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(computed.flatMap((t) => GRAPHIC_PAIRS.map(([fg, bg]) => [t.id, fg, bg, t] as const)))(
    '%s: %s on %s is at least 3:1',
    (_id, fg, bg, theme) => {
      expect(contrast(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(3);
    },
  );

  it('chart series are distinguishable from their neighbours', () => {
    for (const theme of computed) {
      const series = (['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6', 'chart7', 'chart8'] as const).map((k) => theme.colors[k]);
      for (const c of series) expect(contrast(c, theme.colors.surface), `${theme.id} ${c}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('maps tokens to kebab-case custom properties', () => {
    expect(cssVar('accentSoft')).toBe('--c-accent-soft');
    expect(cssVar('chart1')).toBe('--c-chart-1');
  });
});
