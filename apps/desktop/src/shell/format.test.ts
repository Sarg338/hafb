import { describe, expect, it } from 'vitest';
import { backupDate, fileName } from './format.ts';

describe('backupDate', () => {
  it('reads the UTC stamp', () => {
    expect(backupDate('20261008-173019-495Z')?.toISOString()).toBe('2026-10-08T17:30:19.000Z');
  });

  it('returns null for anything else', () => {
    expect(backupDate('yesterday')).toBeNull();
  });
});

describe('fileName', () => {
  it('takes the last path segment and drops .hafb', () => {
    expect(fileName('C:\\Users\\Sarg\\Plans\\Family Budget.hafb')).toBe('Family Budget');
    expect(fileName('/home/x/plan.HAFB')).toBe('plan');
    expect(fileName('notes')).toBe('notes');
  });
});
