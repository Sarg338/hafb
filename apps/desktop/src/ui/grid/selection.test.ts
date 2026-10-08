import { describe, expect, it } from 'vitest';
import { applyClick, EMPTY_SELECTION, extend, headerState, selectAll, selectOnly, toggle, toggleAll } from './selection.ts';

const order = ['a', 'b', 'c', 'd', 'e'];
const ids = (s: { selected: ReadonlySet<string> }) => [...s.selected].sort();

describe('row selection', () => {
  it('click selects one and sets the anchor', () => {
    const s = selectOnly(selectAll(order), 'c');
    expect(ids(s)).toEqual(['c']);
    expect(s.anchor).toBe('c');
  });

  it('ctrl-click toggles and moves the anchor', () => {
    let s = selectOnly(EMPTY_SELECTION, 'a');
    s = toggle(s, 'c');
    expect(ids(s)).toEqual(['a', 'c']);
    s = toggle(s, 'a');
    expect(ids(s)).toEqual(['c']);
    expect(s.anchor).toBe('a');
  });

  it('shift-click selects the range from the anchor in visible order, either direction', () => {
    expect(ids(extend(selectOnly(EMPTY_SELECTION, 'b'), order, 'd'))).toEqual(['b', 'c', 'd']);
    expect(ids(extend(selectOnly(EMPTY_SELECTION, 'd'), order, 'b'))).toEqual(['b', 'c', 'd']);
  });

  it('shift-click replaces, ctrl+shift-click adds', () => {
    const base = toggle(selectOnly(EMPTY_SELECTION, 'e'), 'a');
    expect(ids(extend(base, order, 'b'))).toEqual(['a', 'b']);
    expect(ids(extend(base, order, 'b', true))).toEqual(['a', 'b', 'e']);
  });

  it('shift-click with no anchor selects just that row; the anchor stays put across extends', () => {
    expect(ids(extend(EMPTY_SELECTION, order, 'c'))).toEqual(['c']);
    let s = selectOnly(EMPTY_SELECTION, 'b');
    s = extend(s, order, 'e');
    s = extend(s, order, 'c');
    expect(ids(s)).toEqual(['b', 'c']);
    expect(s.anchor).toBe('b');
  });

  it('applyClick routes modifiers', () => {
    const s0 = selectOnly(EMPTY_SELECTION, 'a');
    expect(ids(applyClick(s0, order, 'c', { shift: false, ctrl: false }))).toEqual(['c']);
    expect(ids(applyClick(s0, order, 'c', { shift: false, ctrl: true }))).toEqual(['a', 'c']);
    expect(ids(applyClick(s0, order, 'c', { shift: true, ctrl: false }))).toEqual(['a', 'b', 'c']);
  });

  it('header checkbox is tri-state and toggles all/none', () => {
    expect(headerState(EMPTY_SELECTION.selected, order)).toBe('none');
    expect(headerState(new Set(['a']), order)).toBe('some');
    expect(headerState(new Set(order), order)).toBe('all');
    expect(ids(toggleAll(EMPTY_SELECTION, order))).toEqual(order);
    expect(ids(toggleAll(selectOnly(EMPTY_SELECTION, 'b'), order))).toEqual(order);
    expect(ids(toggleAll(selectAll(order), order))).toEqual([]);
  });

  it('ignores ids that are not in the order for ranges and header state', () => {
    expect(headerState(new Set(['zzz']), order)).toBe('none');
    expect(ids(extend(selectOnly(EMPTY_SELECTION, 'gone'), order, 'b'))).toEqual(['b']);
  });
});
