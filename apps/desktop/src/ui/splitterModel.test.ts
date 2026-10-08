import { describe, expect, it } from 'vitest';
import { dragWidth, keyWidth } from './splitterModel.ts';

const range = { min: 280, max: 480, step: 16, initial: 328 };

describe('keyWidth', () => {
  it('Left grows a panel on the right edge, Right shrinks it, by one step', () => {
    expect(keyWidth(328, 'ArrowLeft', range, 'end')).toBe(344);
    expect(keyWidth(328, 'ArrowRight', range, 'end')).toBe(312);
  });

  it('is mirrored for a panel on the left edge', () => {
    expect(keyWidth(328, 'ArrowRight', range, 'start')).toBe(344);
  });

  it('Home/End jump to the limits; Enter resets', () => {
    expect(keyWidth(328, 'Home', range, 'end')).toBe(280);
    expect(keyWidth(328, 'End', range, 'end')).toBe(480);
    expect(keyWidth(400, 'Enter', range, 'end')).toBe(328);
  });

  it('clamps at the limits and ignores other keys', () => {
    expect(keyWidth(476, 'ArrowLeft', range, 'end')).toBe(480);
    expect(keyWidth(284, 'ArrowRight', range, 'end')).toBe(280);
    expect(keyWidth(328, 'a', range, 'end')).toBeNull();
  });
});

describe('dragWidth', () => {
  it('follows the pointer, clamped', () => {
    expect(dragWidth(328, 1000, 950, range, 'end')).toBe(378);
    expect(dragWidth(328, 1000, 600, range, 'end')).toBe(480);
    expect(dragWidth(328, 1000, 1200, range, 'end')).toBe(280);
    expect(dragWidth(328, 100, 150, range, 'start')).toBe(378);
  });
});
