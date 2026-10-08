// Pure frame-timing statistics for the grid spike. No DOM access, so it is unit-tested.

export interface FrameSummary {
  frames: number;
  durationMs: number;
  /** Display refresh interval measured while idle, before the run. */
  refreshIntervalMs: number;
  refreshHz: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames longer than 1.5× the refresh interval, i.e. at least one missed vsync. */
  missedFrames: number;
  missedPercent: number;
  /** Frames over 50 ms: visible hitches regardless of refresh rate. */
  hitches: number;
}

/** Nearest-rank percentile of an ascending-sorted list. `p` is 0–100. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index] ?? 0;
}

export function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 50);
}

export function summarizeFrames(deltasMs: readonly number[], refreshIntervalMs: number): FrameSummary {
  const sorted = [...deltasMs].sort((a, b) => a - b);
  const durationMs = deltasMs.reduce((sum, d) => sum + d, 0);
  const missedFrames = deltasMs.filter((d) => d > refreshIntervalMs * 1.5).length;
  return {
    frames: deltasMs.length,
    durationMs,
    refreshIntervalMs,
    refreshHz: refreshIntervalMs > 0 ? 1000 / refreshIntervalMs : 0,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.at(-1) ?? 0,
    missedFrames,
    missedPercent: deltasMs.length > 0 ? (missedFrames / deltasMs.length) * 100 : 0,
    hitches: deltasMs.filter((d) => d > 50).length,
  };
}

export function formatSummary(title: string, s: FrameSummary): string {
  const ms = (n: number) => n.toFixed(1);
  return [
    title,
    `refresh: ${s.refreshHz.toFixed(0)} Hz (${ms(s.refreshIntervalMs)} ms) | frames: ${String(s.frames)} over ${(s.durationMs / 1000).toFixed(1)} s`,
    `frame ms: median ${ms(s.medianMs)} | p95 ${ms(s.p95Ms)} | p99 ${ms(s.p99Ms)} | max ${ms(s.maxMs)}`,
    `missed vsync (>1.5x interval): ${String(s.missedFrames)} (${s.missedPercent.toFixed(1)}%) | hitches >50 ms: ${String(s.hitches)}`,
  ].join('\n');
}
