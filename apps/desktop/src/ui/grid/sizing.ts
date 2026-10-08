// Column widths: defaults per column, user overrides in a map the caller persists. Pure.

export interface SizedColumn {
  id: string;
  /** Default width in CSS px. */
  width: number;
  minWidth?: number;
  maxWidth?: number;
}

export type ColumnWidths = Readonly<Record<string, number>>;

const MIN = 40;
const MAX = 800;
const STEP = 8;
const BIG_STEP = 32;

export function clampWidth(col: SizedColumn, width: number): number {
  return Math.round(Math.max(col.minWidth ?? MIN, Math.min(col.maxWidth ?? MAX, width)));
}

export function widthOf(col: SizedColumn, widths: ColumnWidths): number {
  return clampWidth(col, widths[col.id] ?? col.width);
}

/** The new widths during a drag that started at `startWidth`. */
export function resize(widths: ColumnWidths, col: SizedColumn, startWidth: number, delta: number): Record<string, number> {
  return { ...widths, [col.id]: clampWidth(col, startWidth + delta) };
}

export function resetWidth(widths: ColumnWidths, columnId: string): Record<string, number> {
  return Object.fromEntries(Object.entries(widths).filter(([id]) => id !== columnId));
}

/** Arrow keys on a focused resize handle; null for keys that don't resize. */
export function keyboardResize(widths: ColumnWidths, col: SizedColumn, key: string, shift: boolean): Record<string, number> | null {
  const step = shift ? BIG_STEP : STEP;
  if (key === 'ArrowRight') return resize(widths, col, widthOf(col, widths), step);
  if (key === 'ArrowLeft') return resize(widths, col, widthOf(col, widths), -step);
  return null;
}

export function totalWidth(cols: readonly SizedColumn[], widths: ColumnWidths): number {
  return cols.reduce((sum, c) => sum + widthOf(c, widths), 0);
}
