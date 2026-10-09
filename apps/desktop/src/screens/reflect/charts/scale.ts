// Chart layout helpers: axis ticks and linear scales. Pixel geometry only; amounts come from the engine.

/** A "nice" round axis step (1, 2, 2.5 or 5 × 10^n) covering `span` in about `count` ticks. */
export function niceStep(span: number, count = 4): number {
  if (span <= 0) return 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Ticks from a nice floor at or below `min` to a nice ceiling at or above `max`, including 0. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** Map a value in [d0, d1] to [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** SVG arc path for a donut slice from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
export function donutSlice(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  const end = a0 + sweep;
  const pt = (radius: number, a: number): string => `${(cx + radius * Math.sin(a)).toFixed(2)} ${(cy - radius * Math.cos(a)).toFixed(2)}`;
  const large = sweep > Math.PI ? 1 : 0;
  return [
    `M ${pt(r, a0)}`,
    `A ${String(r)} ${String(r)} 0 ${String(large)} 1 ${pt(r, end)}`,
    `L ${pt(inner, end)}`,
    `A ${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${pt(inner, a0)}`,
    'Z',
  ].join(' ');
}

/** Start and end angles for donut slices, each value's share of `whole`. */
export function donutAngles(values: readonly number[], whole: number): [number, number][] {
  let a = 0;
  return values.map((v) => {
    const a0 = a;
    a += whole > 0 ? (v / whole) * Math.PI * 2 : 0;
    return [a0, a];
  });
}
