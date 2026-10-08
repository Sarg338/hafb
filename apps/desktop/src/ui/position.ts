// Anchored positioning for popovers, menus and tooltips. Pure: rectangles in, coordinates out.
// Prefers the requested side, flips when it doesn't fit, then shifts to stay inside the viewport.

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start' | 'bottom' | 'top';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Position {
  top: number;
  left: number;
  placement: Placement;
}

/** Distance kept from the viewport edges. */
const MARGIN = 8;

const FLIP: Record<Placement, Placement> = {
  'bottom-start': 'top-start',
  'bottom-end': 'top-end',
  'top-start': 'bottom-start',
  'top-end': 'bottom-end',
  'right-start': 'left-start',
  'left-start': 'right-start',
  bottom: 'top',
  top: 'bottom',
};

function place(a: Rect, f: Size, p: Placement, gap: number): { top: number; left: number } {
  switch (p) {
    case 'bottom-start':
      return { top: a.top + a.height + gap, left: a.left };
    case 'bottom-end':
      return { top: a.top + a.height + gap, left: a.left + a.width - f.width };
    case 'bottom':
      return { top: a.top + a.height + gap, left: a.left + (a.width - f.width) / 2 };
    case 'top-start':
      return { top: a.top - gap - f.height, left: a.left };
    case 'top-end':
      return { top: a.top - gap - f.height, left: a.left + a.width - f.width };
    case 'top':
      return { top: a.top - gap - f.height, left: a.left + (a.width - f.width) / 2 };
    case 'right-start':
      return { top: a.top, left: a.left + a.width + gap };
    case 'left-start':
      return { top: a.top, left: a.left - gap - f.width };
  }
}

function fits(pos: { top: number; left: number }, f: Size, v: Size, p: Placement): boolean {
  if (p.startsWith('bottom')) return pos.top + f.height <= v.height - MARGIN;
  if (p.startsWith('top')) return pos.top >= MARGIN;
  if (p === 'right-start') return pos.left + f.width <= v.width - MARGIN;
  return pos.left >= MARGIN;
}

/** Room on the requested side vs. its opposite, for choosing when neither fits. */
function room(a: Rect, v: Size, p: Placement): number {
  if (p.startsWith('bottom')) return v.height - (a.top + a.height);
  if (p.startsWith('top')) return a.top;
  if (p === 'right-start') return v.width - (a.left + a.width);
  return a.left;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)));

export function computePosition(anchor: Rect, floating: Size, viewport: Size, preferred: Placement, gap = 4): Position {
  let placement = preferred;
  let pos = place(anchor, floating, placement, gap);
  if (!fits(pos, floating, viewport, placement)) {
    const flipped = FLIP[placement];
    const alt = place(anchor, floating, flipped, gap);
    if (fits(alt, floating, viewport, flipped) || room(anchor, viewport, flipped) > room(anchor, viewport, placement)) {
      placement = flipped;
      pos = alt;
    }
  }
  return {
    top: Math.round(clamp(pos.top, MARGIN, viewport.height - floating.height - MARGIN)),
    left: Math.round(clamp(pos.left, MARGIN, viewport.width - floating.width - MARGIN)),
    placement,
  };
}
