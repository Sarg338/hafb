import { describe, expect, it } from 'vitest';
import { clampWidth, keyboardResize, resize, resetWidth, totalWidth, widthOf } from './sizing.ts';

const memo = { id: 'memo', width: 200, minWidth: 80, maxWidth: 400 };
const date = { id: 'date', width: 98 };

describe('column sizing', () => {
  it('clamps to the column limits, with defaults when none are given', () => {
    expect(clampWidth(memo, 10)).toBe(80);
    expect(clampWidth(memo, 999)).toBe(400);
    expect(clampWidth(date, 5)).toBe(40);
    expect(clampWidth(date, 5000)).toBe(800);
    expect(clampWidth(date, 120.6)).toBe(121);
  });

  it('a drag sets the width from where the drag started', () => {
    expect(resize({}, memo, 200, 37)).toEqual({ memo: 237 });
    expect(resize({ memo: 237 }, memo, 237, -500)).toEqual({ memo: 80 });
  });

  it('reset (double-click) returns to the default width', () => {
    const w = resetWidth({ memo: 300, date: 120 }, 'memo');
    expect(w).toEqual({ date: 120 });
    expect(widthOf(memo, w)).toBe(200);
  });

  it('keyboard resizing steps 8 px, 32 px with Shift', () => {
    expect(keyboardResize({}, memo, 'ArrowRight', false)).toEqual({ memo: 208 });
    expect(keyboardResize({ memo: 208 }, memo, 'ArrowLeft', true)).toEqual({ memo: 176 });
    expect(keyboardResize({}, memo, 'Enter', false)).toBeNull();
  });

  it('total width sums current widths', () => {
    expect(totalWidth([memo, date], { date: 110 })).toBe(310);
  });
});
