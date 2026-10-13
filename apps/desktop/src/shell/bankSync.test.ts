import { describe, expect, it } from 'vitest';
import type { AccountRecord, PlanData } from '@hafb/store';
import { dueOnOpen, EVERY_MS, fetchStart, fetchWindows, JITTER_MS, localDate, nextDelay, syncSummary } from './bankSync.ts';

const NOW = Date.parse('2026-10-12T15:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function plan(links: (string | null | undefined)[]): PlanData {
  const accounts: AccountRecord[] = links.map((syncedAt, i) => ({
    id: `a${String(i)}`,
    name: `Account ${String(i)}`,
    type: 'checking',
    onBudget: true,
    sortOrder: i,
    createdAt: '2026-01-01T00:00:00Z',
    ...(syncedAt === undefined ? {} : { bankLink: { id: `R${String(i)}`, name: 'Bank', ...(syncedAt === null ? {} : { syncedAt }) } }),
  }));
  return { accounts } as unknown as PlanData;
}

describe('bank sync timing (S8.6, ADR 0006 §6)', () => {
  it('fetches from 5 days before the oldest last sync, never more than 89 days back', () => {
    expect(fetchStart(plan(['2026-10-10T15:00:00Z', '2026-10-12T09:00:00Z']), NOW)).toBe((Date.parse('2026-10-10T15:00:00Z') - 5 * DAY) / 1000);
    // A link that never synced asks for all 89 days.
    expect(fetchStart(plan(['2026-10-10T15:00:00Z', null]), NOW)).toBe((NOW - 89 * DAY) / 1000);
    expect(fetchStart(plan(['2026-03-01T00:00:00Z']), NOW)).toBe((NOW - 89 * DAY) / 1000);
    // Unlinked accounts don't count.
    expect(fetchStart(plan([undefined, '2026-10-11T15:00:00Z']), NOW)).toBe((Date.parse('2026-10-11T15:00:00Z') - 5 * DAY) / 1000);
  });

  it('asks for at most 45 days at a time: one request usually, two for a first sync', () => {
    const now = NOW / 1000;
    expect(fetchWindows(plan(['2026-10-10T15:00:00Z']), NOW)).toEqual([{ start: (Date.parse('2026-10-10T15:00:00Z') - 5 * DAY) / 1000, end: null }]);
    const first = fetchWindows(plan([null]), NOW);
    expect(first).toEqual([
      { start: now - 89 * 86_400, end: now - 44 * 86_400 },
      { start: now - 44 * 86_400, end: null },
    ]);
    // Exactly 45 days is still one request.
    expect(fetchWindows(plan(['2026-09-02T15:00:00Z']), NOW)).toHaveLength(1);
  });

  it('syncs on open only with linked accounts, and not within an hour of the last sync or check', () => {
    expect(dueOnOpen(plan([undefined]), NOW, null)).toBe(false);
    expect(dueOnOpen(plan([null]), NOW, null)).toBe(true);
    expect(dueOnOpen(plan(['2026-10-12T14:30:00Z']), NOW, null)).toBe(false);
    expect(dueOnOpen(plan(['2026-10-12T13:59:00Z']), NOW, null)).toBe(true);
    expect(dueOnOpen(plan(['2026-10-11T00:00:00Z']), NOW, NOW - 10 * 60_000)).toBe(false);
    expect(dueOnOpen(plan(['2026-10-12T14:30:00Z', null]), NOW, null)).toBe(true);
  });

  it('runs about every 6 hours, at a random minute', () => {
    expect(nextDelay(0)).toBe(EVERY_MS - JITTER_MS / 2);
    expect(nextDelay(0.999)).toBeLessThan(EVERY_MS + JITTER_MS / 2);
    expect(nextDelay(0.5)).toBe(EVERY_MS);
  });

  it('dates a SimpleFIN time on this PC’s calendar', () => {
    const noonLocal = new Date(2026, 9, 5, 12, 0, 0).getTime() / 1000;
    expect(localDate(noonLocal)).toBe('2026-10-05');
  });

  it('says what came in, and stays quiet about nothing unless asked', () => {
    expect(syncSummary({ imported: 0, matched: 0 }, false)).toBeNull();
    expect(syncSummary({ imported: 0, matched: 0 }, true)).toBe('Up to date: nothing new from the bank.');
    expect(syncSummary({ imported: 3, matched: 1 }, false)).toBe('From the bank: 3 new transactions to approve, 1 matched to one you entered.');
    expect(syncSummary({ imported: 1, matched: 0 }, true)).toBe('From the bank: 1 new transaction to approve.');
  });
});
