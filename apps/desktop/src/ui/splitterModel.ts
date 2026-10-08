// Pure sizing for Splitter: keyboard steps and pointer drags, clamped to a range.

export interface SplitRange {
  min: number;
  max: number;
  /** Keyboard step in px. */
  step: number;
  /** Reset value (Enter, double-click). */
  initial: number;
}

/** Which edge of its panel the splitter sits on: 'end' panels (an inspector on the right) grow leftward. */
export type SplitSide = 'start' | 'end';

const clamp = (v: number, r: SplitRange): number => Math.min(r.max, Math.max(r.min, Math.round(v)));

/** The new width for a key, or null when the key isn't a splitter key. */
export function keyWidth(width: number, key: string, range: SplitRange, side: SplitSide): number | null {
  const grow = side === 'end' ? 'ArrowLeft' : 'ArrowRight';
  const shrink = side === 'end' ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case grow:
      return clamp(width + range.step, range);
    case shrink:
      return clamp(width - range.step, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    case 'Enter':
      return range.initial;
    default:
      return null;
  }
}

/** Width after dragging from `startX` to `x` (client px). */
export function dragWidth(startWidth: number, startX: number, x: number, range: SplitRange, side: SplitSide): number {
  const delta = side === 'end' ? startX - x : x - startX;
  return clamp(startWidth + delta, range);
}
