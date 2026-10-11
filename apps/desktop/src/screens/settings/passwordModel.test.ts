import { describe, expect, it } from 'vitest';
import type { BackupInfo, RelockReport } from '../../shell/ipc.ts';
import { backupsChoiceLabel, MAX_PASSWORD_CHARS, newPasswordProblem, relockSummary } from './passwordModel.ts';

const backup: BackupInfo = { path: 'C:/b/open-1.hafb', fileName: 'open-1.hafb', kind: 'open', stamp: '20261010-120000-000Z', sizeBytes: 1 };
const report = (relocked: number, unchanged: number, left: number): RelockReport => ({ relocked, unchanged, left: Array.from({ length: left }, () => backup) });

describe('new passwords', () => {
  it('must be entered, fit, and match', () => {
    expect(newPasswordProblem('', '')).toBe('Enter a password.');
    expect(newPasswordProblem('a'.repeat(MAX_PASSWORD_CHARS + 1), 'a'.repeat(MAX_PASSWORD_CHARS + 1))).toMatch(/at most 256/);
    expect(newPasswordProblem('😀'.repeat(MAX_PASSWORD_CHARS), '😀'.repeat(MAX_PASSWORD_CHARS))).toBeNull();
    expect(newPasswordProblem('one', 'two')).toBe('The two passwords don’t match.');
    expect(newPasswordProblem('same', 'same')).toBeNull();
  });
});

describe('backups', () => {
  it('says what happens to them', () => {
    expect(backupsChoiceLabel('set', 1)).toBe('Also lock its backup with this password');
    expect(backupsChoiceLabel('change', 10)).toBe('Also change its 10 backups to the new password');
    expect(backupsChoiceLabel('remove', 3)).toBe('Also unlock its 3 backups');
  });

  it('sums up what happened', () => {
    expect(relockSummary('change', report(9, 1, 0))).toBe('All 10 backups are now changed to the new password.');
    expect(relockSummary('set', report(1, 0, 0))).toBe('Its backup is now locked with the password.');
    expect(relockSummary('set', report(0, 0, 1))).toBeNull();
    expect(relockSummary('change', report(7, 0, 2))).toBe('7 backups are now changed to the new password.');
    expect(relockSummary('remove', report(0, 0, 0))).toBe('The plan has no backups yet.');
  });
});
