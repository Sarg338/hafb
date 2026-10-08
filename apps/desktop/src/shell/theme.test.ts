import { describe, expect, it } from 'vitest';
import { resolveThemeId } from './theme.ts';

describe('resolveThemeId', () => {
  it('follows Windows when set to system', () => {
    expect(resolveThemeId('system', { dark: false, forcedColors: false })).toBe('light');
    expect(resolveThemeId('system', { dark: true, forcedColors: false })).toBe('dark');
  });

  it('a Windows contrast theme wins over light/dark, even when the user chose one', () => {
    expect(resolveThemeId('system', { dark: true, forcedColors: true })).toBe('high-contrast');
    expect(resolveThemeId('light', { dark: false, forcedColors: true })).toBe('high-contrast');
  });

  it('an explicit choice ignores the system light/dark setting', () => {
    expect(resolveThemeId('dark', { dark: false, forcedColors: false })).toBe('dark');
    expect(resolveThemeId('light', { dark: true, forcedColors: false })).toBe('light');
    expect(resolveThemeId('high-contrast', { dark: false, forcedColors: false })).toBe('high-contrast');
  });
});
