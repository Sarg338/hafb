import { describe, expect, it } from 'vitest';
import { endEdit, gridIntent } from './keys.ts';
import type { KeyLike } from './types.ts';

const k = (key: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const item = { isGroupRow: false, editable: true, atFirstColumn: false, expanded: undefined };
const readOnly = { ...item, editable: false };
const group = (expanded: boolean, atFirstColumn = true) => ({ isGroupRow: true, editable: false, atFirstColumn, expanded });

describe('gridIntent (navigation mode)', () => {
  it('arrows, Home/End and paging move; Ctrl is passed for Ctrl+Home/End', () => {
    expect(gridIntent(k('ArrowDown'), item)).toEqual({ type: 'move', key: 'ArrowDown', ctrl: false });
    expect(gridIntent(k('End', { ctrlKey: true }), item)).toEqual({ type: 'move', key: 'End', ctrl: true });
    expect(gridIntent(k('PageUp'), item)).toEqual({ type: 'move', key: 'PageUp', ctrl: false });
  });

  it('Enter and F2 edit an editable cell; typing a printable character edits with that seed', () => {
    expect(gridIntent(k('Enter'), item)).toEqual({ type: 'edit' });
    expect(gridIntent(k('F2'), item)).toEqual({ type: 'edit' });
    expect(gridIntent(k('7'), item)).toEqual({ type: 'edit', seed: '7' });
    expect(gridIntent(k('G', { shiftKey: true }), item)).toEqual({ type: 'edit', seed: 'G' });
  });

  it('typing into a read-only cell does nothing; Ctrl shortcuts are not seeds', () => {
    expect(gridIntent(k('7'), readOnly)).toEqual({ type: 'none' });
    expect(gridIntent(k('Enter'), readOnly)).toEqual({ type: 'none' });
    expect(gridIntent(k('c', { ctrlKey: true }), item)).toEqual({ type: 'none' });
  });

  it('Space toggles the row selection; Ctrl+A selects all; Shift+Up/Down extend', () => {
    expect(gridIntent(k(' '), item)).toEqual({ type: 'toggleSelect' });
    expect(gridIntent(k('a', { ctrlKey: true }), item)).toEqual({ type: 'selectAll' });
    expect(gridIntent(k('ArrowDown', { shiftKey: true }), item)).toEqual({ type: 'extend', key: 'ArrowDown' });
  });

  it('group rows: Enter/Space toggle; Left collapses and Right expands at the first column', () => {
    expect(gridIntent(k('Enter'), group(true))).toEqual({ type: 'toggleGroup' });
    expect(gridIntent(k(' '), group(false))).toEqual({ type: 'toggleGroup' });
    expect(gridIntent(k('ArrowLeft'), group(true))).toEqual({ type: 'collapse' });
    expect(gridIntent(k('ArrowRight'), group(false))).toEqual({ type: 'expand' });
    expect(gridIntent(k('ArrowRight'), group(true))).toEqual({ type: 'move', key: 'ArrowRight', ctrl: false });
    expect(gridIntent(k('ArrowLeft'), group(true, false))).toEqual({ type: 'move', key: 'ArrowLeft', ctrl: false });
  });

  it('Ctrl+Enter adds a row; Shift+F10 / ContextMenu open the row menu', () => {
    expect(gridIntent(k('Enter', { ctrlKey: true }), item)).toEqual({ type: 'addRow' });
    expect(gridIntent(k('F10', { shiftKey: true }), item)).toEqual({ type: 'contextMenu' });
    expect(gridIntent(k('ContextMenu'), item)).toEqual({ type: 'contextMenu' });
  });
});

describe('endEdit', () => {
  const ctx = { rowIds: ['r1', 'r2', 'r3'], columnIds: ['a', 'b', 'c'], pageSize: 10 };
  const editableCols = (_r: string, c: string) => c !== 'a';
  const cell = { rowId: 'r1', columnId: 'c' };

  it('Enter commits and moves down (register) or stays', () => {
    expect(endEdit(ctx, cell, 'enter', { enterMoves: 'down', isEditable: editableCols })).toEqual({
      active: { rowId: 'r2', columnId: 'c' },
      editing: null,
      leaveGrid: false,
      saveAndAdd: false,
    });
    expect(endEdit(ctx, cell, 'enter', { enterMoves: 'none', isEditable: editableCols }).active).toEqual(cell);
  });

  it('Tab commits and keeps editing at the next editable cell', () => {
    const r = endEdit(ctx, cell, 'next', { enterMoves: 'down', isEditable: editableCols });
    expect(r.active).toEqual({ rowId: 'r2', columnId: 'b' });
    expect(r.editing).toEqual({ rowId: 'r2', columnId: 'b' });
  });

  it('Tab past the last editable cell leaves the grid', () => {
    const r = endEdit(ctx, { rowId: 'r3', columnId: 'c' }, 'next', { enterMoves: 'down', isEditable: editableCols });
    expect(r).toMatchObject({ editing: null, leaveGrid: true, active: { rowId: 'r3', columnId: 'c' } });
  });

  it('Esc and clicking away stop editing in place; Ctrl+Enter asks for a new row', () => {
    expect(endEdit(ctx, cell, 'cancel', { enterMoves: 'down', isEditable: editableCols })).toMatchObject({ active: cell, editing: null });
    expect(endEdit(ctx, cell, 'blur', { enterMoves: 'down', isEditable: editableCols })).toMatchObject({ active: cell, editing: null });
    expect(endEdit(ctx, cell, 'commit', { enterMoves: 'down', isEditable: editableCols })).toMatchObject({ active: cell, editing: null, leaveGrid: false });
    expect(endEdit(ctx, cell, 'saveAndAdd', { enterMoves: 'down', isEditable: editableCols })).toMatchObject({ saveAndAdd: true, editing: null });
  });
});
