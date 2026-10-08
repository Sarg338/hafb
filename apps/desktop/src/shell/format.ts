// Small display helpers for the shell (file names, backup times). Not money or plan dates.

/** Backup stamps are UTC ("20261008-173019-495Z"): a Date for local display, or null. */
export function backupDate(stamp: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(stamp);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y === undefined || mo === undefined || d === undefined || h === undefined || mi === undefined || s === undefined) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/** "20261008-173019-495Z" → the user's local date and time, or the stamp unchanged. */
export function backupTime(stamp: string): string {
  return backupDate(stamp)?.toLocaleString() ?? stamp;
}

/** A plan's display name from its path: "C:\…\Family Budget.hafb" → "Family Budget". */
export function fileName(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.hafb$/i, '');
}
