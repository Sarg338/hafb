import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from './themes.ts';
import { COLOR_TOKENS, cssVar, DENSITY_DEFAULTS, MOTION_DEFAULTS, resolveTheme, SHAPE_DEFAULTS, tokenVar, TYPE_DEFAULTS, type Theme } from './tokens.ts';
import { validateTheme } from './validate.ts';

describe('built-in themes', () => {
  it.each(BUILT_IN_THEMES.map((t) => [t.id, t] as const))('%s defines every colour token', (_id, theme: Theme) => {
    for (const token of COLOR_TOKENS) expect(theme.colors[token], token).toBeTruthy();
  });

  it.each(BUILT_IN_THEMES.map((t) => [t.id, t] as const))('%s passes validation (contrast and floors)', (_id, theme: Theme) => {
    expect(validateTheme(theme)).toEqual([]);
  });

  it('keep the approved look: no built-in theme overrides a non-colour token (Sarg, 2026-10-08)', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.type ?? {}, theme.id).toEqual({});
      expect(theme.shape ?? {}, theme.id).toEqual({});
      expect(theme.density ?? {}, theme.id).toEqual({});
      expect(theme.motion ?? {}, theme.id).toEqual({});
      expect(theme.variants ?? {}, theme.id).toEqual({});
      expect(theme.ornament ?? '', theme.id).toBe('');
    }
  });

  it('the approved S3.1 values are the defaults', () => {
    expect(TYPE_DEFAULTS.sizeBody).toBe('13px');
    expect(TYPE_DEFAULTS.sizeMicro).toBe('11.5px');
    expect(SHAPE_DEFAULTS.radius).toBe('4px');
    expect(SHAPE_DEFAULTS.radiusLarge).toBe('8px');
    expect(DENSITY_DEFAULTS.rowPlan).toBe('34px');
    expect(DENSITY_DEFAULTS.rowRegister).toBe('30px');
    expect(MOTION_DEFAULTS.move).toBe('180ms');
  });

  it('maps tokens to kebab-case custom properties', () => {
    expect(cssVar('accentSoft')).toBe('--c-accent-soft');
    expect(cssVar('chart1')).toBe('--c-chart-1');
    expect(tokenVar.type('fontUi')).toBe('--t-font-ui');
    expect(tokenVar.density('space3')).toBe('--d-space-3');
    expect(tokenVar.shape('groupRuleStyle')).toBe('--s-group-rule-style');
  });
});

describe('theme validation catches unusable themes', () => {
  const base = BUILT_IN_THEMES[0];
  if (!base) throw new Error('no themes');

  it('low contrast', () => {
    const bad: Theme = { ...base, id: 'bad', colors: { ...base.colors, textMuted: '#DDDDDD' } };
    expect(validateTheme(bad).map((p) => p.token)).toContain('textMuted');
  });

  it('tiny text, short rows, thin focus', () => {
    const bad: Theme = { ...base, id: 'bad', type: { sizeMicro: '9px' }, density: { rowRegister: '20px' }, shape: { focusWidth: '1px' } };
    const tokens = validateTheme(bad).map((p) => p.token);
    expect(tokens).toEqual(expect.arrayContaining(['--t-size-micro', '--d-row-register', '--s-focus-width']));
  });

  it('non-px sizes are rejected rather than guessed', () => {
    const bad: Theme = { ...base, id: 'bad', type: { sizeBody: '1rem' } };
    expect(validateTheme(bad)[0]?.message).toMatch(/px value/);
  });
});

describe('resolveTheme', () => {
  it('fills defaults and sets the pill variant attribute', () => {
    const base = BUILT_IN_THEMES[0];
    if (!base) throw new Error('no themes');
    const r = resolveTheme(base);
    expect(r.vars['--t-font-ui']).toBe(TYPE_DEFAULTS.fontUi);
    expect(r.vars['--d-row-plan']).toBe('34px');
    expect(r.data).toEqual({ theme: base.id, pill: 'filled' });
    expect(r.ornament).toBe('');
  });
});
