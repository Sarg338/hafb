import { describe, expect, it } from 'vitest';
import { moveActive, nextEditable } from './navigation.ts';

const ctx = { rowIds: ['r1', 'r2', 'r3', 'r4', 'r5'], columnIds: ['a', 'b', 'c'], pageSize: 2 };
const at = (rowId: string, columnId: string) => ({ rowId, columnId });

describe('moveActive', () => {
  it('starts at the first cell when nothing is active', () => {
    expect(moveActive(ctx, null, 'ArrowDown', false)).toEqual(at('r1', 'a'));
  });

  it('arrows move one cell and clamp at the edges', () => {
    expect(moveActive(ctx, at('r2', 'b'), 'ArrowDown', false)).toEqual(at('r3', 'b'));
    expect(moveActive(ctx, at('r1', 'b'), 'ArrowUp', false)).toEqual(at('r1', 'b'));
    expect(moveActive(ctx, at('r2', 'c'), 'ArrowRight', false)).toEqual(at('r2', 'c'));
    expect(moveActive(ctx, at('r2', 'a'), 'ArrowLeft', false)).toEqual(at('r2', 'a'));
  });

  it('Home/End go to the row ends; Ctrl+Home/End to the first/last cell of the grid', () => {
    expect(moveActive(ctx, at('r3', 'b'), 'Home', false)).toEqual(at('r3', 'a'));
    expect(moveActive(ctx, at('r3', 'b'), 'End', false)).toEqual(at('r3', 'c'));
    expect(moveActive(ctx, at('r3', 'b'), 'Home', true)).toEqual(at('r1', 'a'));
    expect(moveActive(ctx, at('r3', 'b'), 'End', true)).toEqual(at('r5', 'c'));
  });

  it('PageUp/PageDown move by a page and clamp', () => {
    expect(moveActive(ctx, at('r1', 'b'), 'PageDown', false)).toEqual(at('r3', 'b'));
    expect(moveActive(ctx, at('r4', 'b'), 'PageDown', false)).toEqual(at('r5', 'b'));
    expect(moveActive(ctx, at('r2', 'b'), 'PageUp', false)).toEqual(at('r1', 'b'));
  });

  it('recovers when the active row disappeared (collapsed group)', () => {
    expect(moveActive(ctx, at('gone', 'b'), 'ArrowDown', false)).toEqual(at('r1', 'b'));
  });

  it('an empty grid has no active cell', () => {
    expect(moveActive({ ...ctx, rowIds: [] }, null, 'ArrowDown', false)).toBeNull();
  });
});

describe('nextEditable (Tab while editing)', () => {
  const editable = (rowId: string, columnId: string) => columnId !== 'a' && rowId !== 'r3';

  it('moves to the next editable cell in reading order, wrapping rows and skipping non-editable', () => {
    expect(nextEditable(ctx, at('r1', 'b'), 1, editable)).toEqual(at('r1', 'c'));
    expect(nextEditable(ctx, at('r1', 'c'), 1, editable)).toEqual(at('r2', 'b'));
    expect(nextEditable(ctx, at('r2', 'c'), 1, editable)).toEqual(at('r4', 'b'));
  });

  it('Shift+Tab goes backwards', () => {
    expect(nextEditable(ctx, at('r4', 'b'), -1, editable)).toEqual(at('r2', 'c'));
  });

  it('returns null at the ends so focus can leave the grid (no trap)', () => {
    expect(nextEditable(ctx, at('r5', 'c'), 1, editable)).toBeNull();
    expect(nextEditable(ctx, at('r1', 'b'), -1, editable)).toBeNull();
  });
});
