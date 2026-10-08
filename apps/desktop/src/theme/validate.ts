// Theme validation (ADR 0003): what every theme, built-in or future user theme, must satisfy before it
// is applied. Contrast pairs are the ones the UI actually draws; floors keep any skin usable.
import { contrast, parseHex } from './contrast.ts';
import { resolveTheme, tokenVar, type ColorToken, type Theme } from './tokens.ts';

/** Text-on-surface pairs the UI draws: 4.5:1 (WCAG 1.4.3). */
export const TEXT_PAIRS: readonly [ColorToken, ColorToken][] = [
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
  // Status text is drawn on rows: plain, hovered and selected.
  ['warnText', 'surface'],
  ['warnText', 'hover'],
  ['warnText', 'selected'],
  ['badText', 'surface'],
  ['badText', 'hover'],
  ['badText', 'selected'],
  ['negative', 'raised'],
  // Reflect's "up" figure: the funded green as plain text on the page.
  ['fundedFg', 'surface'],
  ['fundedFg', 'app'],
  ['textSubtle', 'hover'],
  ['textSubtle', 'selected'],
];

/** State graphics, focus and input borders: 3:1 against the surface (WCAG 1.4.11). */
export const GRAPHIC_PAIRS: readonly [ColorToken, ColorToken][] = [
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
  ['chart1', 'surface'],
  ['chart2', 'surface'],
  ['chart3', 'surface'],
  ['chart4', 'surface'],
  ['chart5', 'surface'],
  ['chart6', 'surface'],
  ['chart7', 'surface'],
  ['chart8', 'surface'],
];

/** Minimums any skin must keep (ADR 0003 amendment). */
export const FLOORS = {
  /** Smallest text size; the approved look's smallest is 11.5 px. */
  textPx: 11,
  rowPx: 28,
  focusPx: 2,
  controlPx: 24,
};

const px = (value: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return m?.[1] === undefined ? null : Number(m[1]);
};

export interface ThemeProblem {
  token: string;
  message: string;
}

/** Problems that would make this theme unreadable or unusable. Empty = valid. */
export function validateTheme(theme: Theme): ThemeProblem[] {
  const problems: ThemeProblem[] = [];
  const { vars } = resolveTheme(theme);
  const need = (name: string, min: number, what: string): void => {
    const value = vars[name] ?? '';
    const n = px(value);
    if (n === null) problems.push({ token: name, message: `${what} must be a px value, got "${value}"` });
    else if (n < min) problems.push({ token: name, message: `${what} is ${String(n)}px; the minimum is ${String(min)}px` });
  };
  for (const name of Object.keys(vars).filter((v) => v.startsWith('--t-size-'))) need(name, FLOORS.textPx, 'Text size');
  for (const k of ['rowPlan', 'rowRegister', 'rowGroup', 'rowHeader'] as const) need(tokenVar.density(k), FLOORS.rowPx, 'Row height');
  for (const k of ['control', 'controlCompact', 'chip', 'controlSmall'] as const) need(tokenVar.density(k), FLOORS.controlPx, 'Control height');
  need(tokenVar.shape('focusWidth'), FLOORS.focusPx, 'Focus outline');

  if (theme.system !== true) {
    const check = (pairs: readonly [ColorToken, ColorToken][], min: number): void => {
      for (const [fg, bg] of pairs) {
        const a = theme.colors[fg];
        const b = theme.colors[bg];
        if (!parseHex(a) || !parseHex(b)) {
          problems.push({ token: fg, message: `${fg} and ${bg} must be #rgb/#rrggbb colours to be checked` });
          continue;
        }
        const ratio = contrast(a, b);
        if (ratio < min) problems.push({ token: fg, message: `${fg} on ${bg} is ${ratio.toFixed(2)}:1; needs ${String(min)}:1` });
      }
    };
    check(TEXT_PAIRS, 4.5);
    check(GRAPHIC_PAIRS, 3);
  }
  return problems;
}
