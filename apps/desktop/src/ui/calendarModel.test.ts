import { describe, expect, it } from 'vitest';
import { calendarKey, monthGrid } from './calendarModel.ts';

describe('monthGrid', () => {
  it('is six Sunday-first weeks covering the month', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);
    // Oct 1 2026 is a Thursday: the grid starts on Sunday Sep 27.
    expect(grid[0]?.[0]).toBe('2026-09-27');
    expect(grid[0]?.[4]).toBe('2026-10-01');
    expect(grid[5]?.[6]).toBe('2026-11-07');
  });

  it('handles a month starting on Sunday', () => {
    expect(monthGrid('2026-02')[0]?.[0]).toBe('2026-02-01');
  });
});

describe('calendarKey', () => {
  const d = '2026-10-14' as const;
  it.each([
    ['ArrowRight', '2026-10-15'],
    ['ArrowLeft', '2026-10-13'],
    ['ArrowDown', '2026-10-21'],
    ['ArrowUp', '2026-10-07'],
    ['PageDown', '2026-11-14'],
    ['PageUp', '2026-09-14'],
    ['Home', '2026-10-11'],
    ['End', '2026-10-17'],
  ])('%s', (key, expected) => {
    expect(calendarKey(d, key)).toBe(expected);
  });

  it('clamps month moves to the month end', () => {
    expect(calendarKey('2026-01-31', 'PageDown')).toBe('2026-02-28');
  });

  it('ignores other keys', () => {
    expect(calendarKey(d, 'a')).toBeNull();
  });
});
