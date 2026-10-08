import { describe, expect, it } from 'vitest';
import { clampMonth, monthPickerKey, planMonthBounds } from './monthPickerModel.ts';

describe('month picker keys', () => {
  const min = '2025-03';
  const max = '2027-10';
  it('moves by month, row and year', () => {
    expect(monthPickerKey('2026-05', 'ArrowRight', min, max)).toBe('2026-06');
    expect(monthPickerKey('2026-05', 'ArrowLeft', min, max)).toBe('2026-04');
    expect(monthPickerKey('2026-05', 'ArrowDown', min, max)).toBe('2026-08');
    expect(monthPickerKey('2026-05', 'ArrowUp', min, max)).toBe('2026-02');
    expect(monthPickerKey('2026-05', 'PageDown', min, max)).toBe('2027-05');
    expect(monthPickerKey('2026-12', 'ArrowRight', min, max)).toBe('2027-01');
  });
  it('goes to the ends of the row with Home and End', () => {
    expect(monthPickerKey('2026-05', 'Home', min, max)).toBe('2026-04');
    expect(monthPickerKey('2026-05', 'End', min, max)).toBe('2026-06');
  });
  it('stays inside the plan', () => {
    expect(monthPickerKey('2025-04', 'ArrowUp', min, max)).toBe(min);
    expect(monthPickerKey('2027-09', 'PageDown', min, max)).toBe(max);
    expect(clampMonth('2030-01', min, max)).toBe(max);
    expect(monthPickerKey('2026-05', 'a', min, max)).toBeNull();
  });
});

describe('plan month bounds', () => {
  it('runs from the first month to a year ahead, or the last assigned month if later', () => {
    expect(planMonthBounds('2024-01', '2026-10', null)).toEqual({ min: '2024-01', max: '2027-10' });
    expect(planMonthBounds('2024-01', '2026-10', '2028-02')).toEqual({ min: '2024-01', max: '2028-02' });
    expect(planMonthBounds('2024-01', '2026-10', '2026-12')).toEqual({ min: '2024-01', max: '2027-10' });
  });
  it('never starts after the current month', () => {
    expect(planMonthBounds('2026-12', '2026-10', null).min).toBe('2026-10');
  });
});
