// Bank sync timing (S8.6, ADR 0006 §6). SimpleFIN refreshes from banks about once a day and allows
// about 24 requests a day, so HAFB asks when a plan opens (if its last sync is over an hour old),
// about every 6 hours at a random minute while it stays open, and on Sync Now. Nothing runs while
// the app is closed. Each sync reaches 5 days before the last one (SimpleFIN's advice), never
// more than 89 days back (SimpleFIN allows 90, and warns when a start a few hours past that is
// capped), asking for at most 45 days at a time (SimpleFIN's recommendation).
import { linkedAccounts, type PlanData } from '@hafb/store';
import { makeDate, type ISODate } from '@hafb/shared';

const DAY_MS = 86_400_000;
export const OVERLAP_DAYS = 5;
export const MAX_DAYS = 89;
/** SimpleFIN's recommended longest request. */
export const WINDOW_DAYS = 45;
export const OPEN_AFTER_MS = 3_600_000;
export const EVERY_MS = 6 * 3_600_000;
/** The spread around 6 hours, so syncs don't land on the hour with everyone else's. */
export const JITTER_MS = 40 * 60_000;

/** The Unix time (seconds) the next fetch starts from: 5 days before the oldest link's last sync, at most 89 days back. */
export function fetchStart(plan: PlanData, nowMs: number): number {
  const floor = nowMs - MAX_DAYS * DAY_MS;
  let start = nowMs;
  for (const a of linkedAccounts(plan)) {
    const synced = a.bankLink?.syncedAt === undefined ? Number.NaN : Date.parse(a.bankLink.syncedAt);
    start = Math.min(start, Number.isNaN(synced) ? floor : synced - OVERLAP_DAYS * DAY_MS);
  }
  return Math.floor(Math.max(start, floor) / 1000);
}

/**
 * The requests a sync makes: from `fetchStart` to now, in windows of at most 45 days (SimpleFIN
 * warns past that, live answer 2026-10-12). Usually one; two for a first sync or after six weeks away.
 * Unix seconds; `end` is exclusive, null = now.
 */
export function fetchWindows(plan: PlanData, nowMs: number): { start: number; end: number | null }[] {
  const now = Math.floor(nowMs / 1000);
  const span = WINDOW_DAYS * (DAY_MS / 1000);
  const windows: { start: number; end: number | null }[] = [];
  for (let start = fetchStart(plan, nowMs); ; start += span) {
    const last = now - start <= span;
    windows.push({ start, end: last ? null : start + span });
    if (last) return windows;
  }
}

/** Sync when the plan opens? Only with linked accounts, and not within an hour of the last sync or check. */
export function dueOnOpen(plan: PlanData, nowMs: number, lastCheckMs: number | null): boolean {
  const linked = linkedAccounts(plan);
  if (linked.length === 0) return false;
  const times = linked.map((a) => (a.bankLink?.syncedAt === undefined ? Number.NaN : Date.parse(a.bankLink.syncedAt))).filter((t) => !Number.isNaN(t));
  const last = Math.max(lastCheckMs ?? Number.NEGATIVE_INFINITY, ...(times.length === linked.length ? times : [Number.NEGATIVE_INFINITY]));
  return nowMs - last >= OPEN_AFTER_MS;
}

/** Milliseconds to the next automatic sync, given a random number in [0, 1). */
export function nextDelay(random: number): number {
  return Math.round(EVERY_MS - JITTER_MS / 2 + random * JITTER_MS);
}

/** A Unix time (seconds) as this PC's local calendar date. */
export function localDate(unixSeconds: number): ISODate {
  const d = new Date(unixSeconds * 1000);
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** The toast after a sync. */
export function syncSummary(counts: { imported: number; matched: number }, manual: boolean): string | null {
  const { imported, matched } = counts;
  if (imported === 0 && matched === 0) return manual ? 'Up to date: nothing new from the bank.' : null;
  const parts: string[] = [];
  if (imported > 0) parts.push(`${String(imported)} new transaction${imported === 1 ? '' : 's'} to approve`);
  if (matched > 0) parts.push(`${String(matched)} matched to ${matched === 1 ? 'one' : 'ones'} you entered`);
  return `From the bank: ${parts.join(', ')}.`;
}
