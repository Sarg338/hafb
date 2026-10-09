// Series fills for every chart. Colour by default; with "differentiate without colour" (or high
// contrast) each series also gets its own pattern, so series stay apart without hue. The CSS in
// Reflect.module.css (and the mockup's reflect.css) switch `--s-fill-N` between the token colour and `url(#rf-pat-N)`.
import type { ReactNode } from 'react';

const SHAPES: ((n: number) => ReactNode)[] = [
  () => null,
  (n) => <path d="M0 6 L6 0" stroke={`var(--c-chart-${String(n)})`} strokeWidth="1.6" />,
  (n) => <circle cx="3" cy="3" r="1.4" fill={`var(--c-chart-${String(n)})`} />,
  (n) => <path d="M0 3 H6" stroke={`var(--c-chart-${String(n)})`} strokeWidth="1.6" />,
  (n) => <path d="M3 0 V6" stroke={`var(--c-chart-${String(n)})`} strokeWidth="1.6" />,
  (n) => <path d="M0 0 L6 6 M6 0 L0 6" stroke={`var(--c-chart-${String(n)})`} strokeWidth="1.2" />,
  (n) => <path d="M0 0 L6 6" stroke={`var(--c-chart-${String(n)})`} strokeWidth="1.6" />,
  (n) => <rect x="1" y="1" width="2.5" height="2.5" fill={`var(--c-chart-${String(n)})`} />,
];

export const SERIES_COUNT = 8;

/** CSS fill for series i (0-based), cycling through the eight chart tokens. */
export const seriesFill = (i: number): string => `var(--s-fill-${String((i % SERIES_COUNT) + 1)})`;
export const seriesColor = (i: number): string => `var(--c-chart-${String((i % SERIES_COUNT) + 1)})`;

/** Rendered once per Reflect screen; patterns are referenced by id from every chart. */
export function SeriesPatterns() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false" data-series-patterns="">
      <defs>
        {SHAPES.map((shape, i) => {
          const n = i + 1;
          return (
            <pattern key={n} id={`rf-pat-${String(n)}`} width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill={`var(--c-chart-${String(n)})`} fillOpacity={i === 0 ? 1 : 0.28} />
              {shape(n)}
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}

/** A legend key that matches the series fill, pattern included. */
export function Swatch({ index, className = 'rf-swatch' }: { index: number; className?: string | undefined }) {
  return (
    <svg className={className} width="12" height="12" aria-hidden="true" focusable="false">
      <rect width="12" height="12" rx="3" fill={seriesFill(index)} />
    </svg>
  );
}
