// Active-cell movement for the grid (WAI-ARIA grid keyboard model). Pure.
import type { CellRef } from './types.ts';

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageUp' | 'PageDown';

export const NAV_KEYS: ReadonlySet<string> = new Set<NavKey>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

export const isNavKey = (key: string): key is NavKey => NAV_KEYS.has(key);

export interface NavContext {
  /** Visible rows in order (group header rows included: they are navigable). */
  rowIds: readonly string[];
  columnIds: readonly string[];
  /** Rows per PageUp/PageDown. */
  pageSize: number;
}

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max));

export function moveActive(ctx: NavContext, active: CellRef | null, key: NavKey, ctrl: boolean): CellRef | null {
  const lastRow = ctx.rowIds.length - 1;
  const lastCol = ctx.columnIds.length - 1;
  if (lastRow < 0 || lastCol < 0) return null;
  const cell = (r: number, c: number): CellRef | null => {
    const rowId = ctx.rowIds[clamp(r, lastRow)];
    const columnId = ctx.columnIds[clamp(c, lastCol)];
    return rowId === undefined || columnId === undefined ? null : { rowId, columnId };
  };

  const c0 = active === null ? 0 : Math.max(0, ctx.columnIds.indexOf(active.columnId));
  const rFound = active === null ? -1 : ctx.rowIds.indexOf(active.rowId);
  // No active cell yet, or its row vanished (e.g. a collapsed group): land on the first row.
  if (rFound < 0) return cell(0, c0);

  switch (key) {
    case 'ArrowUp':
      return cell(rFound - 1, c0);
    case 'ArrowDown':
      return cell(rFound + 1, c0);
    case 'ArrowLeft':
      return cell(rFound, c0 - 1);
    case 'ArrowRight':
      return cell(rFound, c0 + 1);
    case 'Home':
      return ctrl ? cell(0, 0) : cell(rFound, 0);
    case 'End':
      return ctrl ? cell(lastRow, lastCol) : cell(rFound, lastCol);
    case 'PageUp':
      return cell(rFound - Math.max(1, ctx.pageSize), c0);
    case 'PageDown':
      return cell(rFound + Math.max(1, ctx.pageSize), c0);
  }
}

/**
 * The next (dir 1) or previous (dir -1) editable cell in reading order after `from`, crossing rows.
 * Null at either end: Tab then leaves the grid instead of trapping focus.
 */
export function nextEditable(
  ctx: NavContext,
  from: CellRef,
  dir: 1 | -1,
  isEditable: (rowId: string, columnId: string) => boolean,
): CellRef | null {
  const cols = ctx.columnIds.length;
  const total = ctx.rowIds.length * cols;
  const r = ctx.rowIds.indexOf(from.rowId);
  const c = ctx.columnIds.indexOf(from.columnId);
  if (r < 0 || c < 0) return null;
  for (let pos = r * cols + c + dir; pos >= 0 && pos < total; pos += dir) {
    const rowId = ctx.rowIds[Math.floor(pos / cols)];
    const columnId = ctx.columnIds[pos % cols];
    if (rowId !== undefined && columnId !== undefined && isEditable(rowId, columnId)) return { rowId, columnId };
  }
  return null;
}
