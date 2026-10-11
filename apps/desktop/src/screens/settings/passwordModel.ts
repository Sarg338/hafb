// Plan passwords (S8.3b, ADR 0010): what the password dialog checks and says. Rust does the
// locking; this only decides what the user sees.
import type { RelockReport } from '../../shell/ipc.ts';

/** Same limit as the Rust side (`lock::MAX_PASSWORD_CHARS`): inside what Windows can remember. */
export const MAX_PASSWORD_CHARS = 256;

export type PasswordMode = 'set' | 'change' | 'remove';

/** What's wrong with a new password and its confirmation, or null when it can be used. */
export function newPasswordProblem(next: string, again: string): string | null {
  if (next === '') return 'Enter a password.';
  // Code points, as Rust counts them.
  if (Array.from(next).length > MAX_PASSWORD_CHARS) return `Use at most ${String(MAX_PASSWORD_CHARS)} characters.`;
  if (again !== next) return 'The two passwords don’t match.';
  return null;
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** The backups checkbox label: what happens to them alongside the plan. */
export function backupsChoiceLabel(mode: PasswordMode, count: number): string {
  const these = count === 1 ? 'its backup' : `its ${String(count)} backups`;
  if (mode === 'set') return `Also lock ${these} with this password`;
  if (mode === 'change') return `Also change ${these} to the new password`;
  return `Also unlock ${these}`;
}

/** One line on what happened to the backups; null when none changed and some were left (the list says it). */
export function relockSummary(mode: PasswordMode, r: RelockReport): string | null {
  const done = r.relocked + r.unchanged;
  const verb = mode === 'remove' ? 'unlocked' : mode === 'set' ? 'locked with the password' : 'changed to the new password';
  if (done === 0) return r.left.length === 0 ? 'The plan has no backups yet.' : null;
  if (r.left.length === 0) return done === 1 ? `Its backup is now ${verb}.` : `All ${String(done)} backups are now ${verb}.`;
  return `${plural(done, 'backup', 'backups')} ${done === 1 ? 'is' : 'are'} now ${verb}.`;
}

/** The title after the change. */
export function doneTitle(mode: PasswordMode): string {
  if (mode === 'set') return 'The plan is locked';
  if (mode === 'change') return 'Password changed';
  return 'Password removed';
}
