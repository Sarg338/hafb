import { describe, expect, it } from 'vitest';
import { computePosition } from './position.ts';

const viewport = { width: 1000, height: 800 };
const anchor = { top: 100, left: 100, width: 120, height: 30 };

describe('computePosition', () => {
  it('places below-start with the gap', () => {
    expect(computePosition(anchor, { width: 200, height: 150 }, viewport, 'bottom-start', 4)).toEqual({ top: 134, left: 100, placement: 'bottom-start' });
  });

  it('aligns the end edges for bottom-end', () => {
    expect(computePosition(anchor, { width: 200, height: 150 }, viewport, 'bottom-end', 4)).toEqual({ top: 134, left: 20, placement: 'bottom-end' });
  });

  it('flips above when there is no room below', () => {
    const low = { ...anchor, top: 700 };
    expect(computePosition(low, { width: 200, height: 150 }, viewport, 'bottom-start', 4)).toEqual({ top: 546, left: 100, placement: 'top-start' });
  });

  it('stays below when neither side fits but below has more room', () => {
    const mid = { ...anchor, top: 300 };
    const r = computePosition(mid, { width: 200, height: 700 }, viewport, 'bottom-start', 4);
    expect(r.placement).toBe('bottom-start');
    expect(r.top).toBe(viewport.height - 700 - 8); // shifted up to stay inside the margin
  });

  it('shifts horizontally to stay inside the viewport', () => {
    const right = { ...anchor, left: 950 };
    expect(computePosition(right, { width: 200, height: 100 }, viewport, 'bottom-start', 4).left).toBe(1000 - 200 - 8);
    const left = { ...anchor, left: -50 };
    expect(computePosition(left, { width: 200, height: 100 }, viewport, 'bottom-start', 4).left).toBe(8);
  });

  it('right-start sits beside the anchor and flips left', () => {
    expect(computePosition(anchor, { width: 180, height: 100 }, viewport, 'right-start', 2)).toEqual({ top: 100, left: 222, placement: 'right-start' });
    const edge = { ...anchor, left: 880 };
    expect(computePosition(edge, { width: 180, height: 100 }, viewport, 'right-start', 2)).toEqual({ top: 100, left: 698, placement: 'left-start' });
  });

  it('point anchors (context menus) open at the pointer', () => {
    const point = { top: 300, left: 400, width: 0, height: 0 };
    expect(computePosition(point, { width: 160, height: 120 }, viewport, 'bottom-start', 0)).toEqual({ top: 300, left: 400, placement: 'bottom-start' });
  });
});
