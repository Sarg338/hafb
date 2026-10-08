// The grid's keyboard model (S3.4), as pure functions: what a key means in navigation mode, and
// where the active cell goes when an edit ends. The DataGrid component only executes these.
import { isNavKey, moveActive, nextEditable, type NavContext, type NavKey } from './navigation.ts';
import type { CellRef, KeyLike } from './types.ts';

export type GridIntent =
  | { type: 'move'; key: NavKey; ctrl: boolean }
  | { type: 'extend'; key: 'ArrowUp' | 'ArrowDown' }
  | { type: 'edit'; seed?: string }
  | { type: 'toggleSelect' }
  | { type: 'selectAll' }
  | { type: 'toggleGroup' }
  | { type: 'collapse' }
  | { type: 'expand' }
  | { type: 'addRow' }
  | { type: 'contextMenu' }
  | { type: 'none' };

export interface CellContext {
  isGroupRow: boolean;
  editable: boolean;
  /** The active cell is in the first column (tree expand/collapse keys apply there). */
  atFirstColumn: boolean;
  expanded: boolean | undefined;
}

const isPrintable = (e: KeyLike): boolean => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

/** What a key press means while navigating (not editing). */
export function gridIntent(e: KeyLike, cell: CellContext): GridIntent {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return { type: 'contextMenu' };
  if (ctrl && e.key === 'Enter') return { type: 'addRow' };
  if (ctrl && (e.key === 'a' || e.key === 'A')) return { type: 'selectAll' };

  if (cell.isGroupRow) {
    if (e.key === 'Enter' || e.key === ' ') return { type: 'toggleGroup' };
    if (cell.atFirstColumn && e.key === 'ArrowLeft' && cell.expanded === true) return { type: 'collapse' };
    if (cell.atFirstColumn && e.key === 'ArrowRight' && cell.expanded === false) return { type: 'expand' };
  }

  if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return { type: 'extend', key: e.key };
  if (isNavKey(e.key)) return { type: 'move', key: e.key, ctrl };
  if (e.key === ' ' && !cell.isGroupRow) return { type: 'toggleSelect' };
  if (!cell.editable) return { type: 'none' };
  if (e.key === 'Enter' || e.key === 'F2') return { type: 'edit' };
  if (isPrintable(e)) return { type: 'edit', seed: e.key };
  return { type: 'none' };
}

/**
 * How an edit ended; the editor reports one of these. enter = Enter; next/prev = Tab/Shift+Tab;
 * saveAndAdd = Ctrl+Enter; commit = saved without a key (e.g. a picker option clicked), stay;
 * cancel = Esc; blur = focus went elsewhere (the editor already saved), don't refocus.
 */
export type EditEnd = 'enter' | 'next' | 'prev' | 'saveAndAdd' | 'commit' | 'cancel' | 'blur';

export interface EditOutcome {
  active: CellRef;
  /** A cell to keep editing in (Tab moves the editor along), else null. */
  editing: CellRef | null;
  /** Tab ran off either end: focus should leave the grid. */
  leaveGrid: boolean;
  saveAndAdd: boolean;
}

export function endEdit(
  ctx: NavContext,
  cell: CellRef,
  end: EditEnd,
  opts: { enterMoves: 'down' | 'none'; isEditable: (rowId: string, columnId: string) => boolean },
): EditOutcome {
  const stay: EditOutcome = { active: cell, editing: null, leaveGrid: false, saveAndAdd: false };
  switch (end) {
    case 'enter':
      return opts.enterMoves === 'down' ? { ...stay, active: moveActive(ctx, cell, 'ArrowDown', false) ?? cell } : stay;
    case 'next':
    case 'prev': {
      const next = nextEditable(ctx, cell, end === 'next' ? 1 : -1, opts.isEditable);
      return next ? { active: next, editing: next, leaveGrid: false, saveAndAdd: false } : { ...stay, leaveGrid: true };
    }
    case 'saveAndAdd':
      return { ...stay, saveAndAdd: true };
    case 'commit':
    case 'cancel':
    case 'blur':
      return stay;
  }
}
