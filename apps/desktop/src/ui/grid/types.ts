// Shared data shapes for the editable grid (S3.4). Pure: no React, no DOM.

export type GridRowKind = 'item' | 'group';

/** One input row. Group rows precede their items; items name their group with `groupId`. */
export interface GridRow<T> {
  kind: GridRowKind;
  id: string;
  data: T;
  /** Item rows only: the group row they belong to. */
  groupId?: string;
}

/** A cell address. */
export interface CellRef {
  rowId: string;
  columnId: string;
}

/** The subset of a keyboard event the grid models read. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const sameCell = (a: CellRef | null, b: CellRef | null): boolean =>
  a === b || (a !== null && b !== null && a.rowId === b.rowId && a.columnId === b.columnId);
