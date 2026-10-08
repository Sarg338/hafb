import { describe, expect, it } from 'vitest';
import { percentile, summarizeFrames } from './frameStats.ts';

describe('frame statistics', () => {
  it('uses nearest-rank percentiles and counts missed vsyncs against the idle interval', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);

    const deltas = [...Array<number>(98).fill(16.7), 30, 60];
    const s = summarizeFrames(deltas, 16.7);
    expect(s.frames).toBe(100);
    expect(s.missedFrames).toBe(2);
    expect(s.hitches).toBe(1);
    expect(s.maxMs).toBe(60);
    expect(Math.round(s.refreshHz)).toBe(60);
  });
});
