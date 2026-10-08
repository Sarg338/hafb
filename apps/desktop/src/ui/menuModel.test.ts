import { describe, expect, it } from 'vitest';
import { nextIndex, typeahead, type MenuModelItem } from './menuModel.ts';

const items: MenuModelItem[] = [
  { label: 'Assign' },
  { separator: true, label: '' },
  { label: 'Move money' },
  { label: 'Hide', disabled: true },
  { label: 'Hold for next month' },
  { label: 'Delete' },
];

describe('nextIndex', () => {
  it('moves down, skipping separators and disabled items', () => {
    expect(nextIndex(items, 0, 'ArrowDown')).toBe(2);
    expect(nextIndex(items, 2, 'ArrowDown')).toBe(4);
  });

  it('wraps at both ends', () => {
    expect(nextIndex(items, 5, 'ArrowDown')).toBe(0);
    expect(nextIndex(items, 0, 'ArrowUp')).toBe(5);
  });

  it('moves up skipping disabled', () => {
    expect(nextIndex(items, 4, 'ArrowUp')).toBe(2);
  });

  it('Home and End go to the first and last enabled item', () => {
    expect(nextIndex(items, 4, 'Home')).toBe(0);
    expect(nextIndex(items, 0, 'End')).toBe(5);
  });

  it('from no focus, down goes first and up goes last', () => {
    expect(nextIndex(items, -1, 'ArrowDown')).toBe(0);
    expect(nextIndex(items, -1, 'ArrowUp')).toBe(5);
  });

  it('returns -1 when nothing is focusable', () => {
    expect(nextIndex([{ label: 'x', disabled: true }], -1, 'ArrowDown')).toBe(-1);
  });

  it('other keys keep the current index', () => {
    expect(nextIndex(items, 2, 'x')).toBe(2);
  });
});

describe('typeahead', () => {
  it('jumps to the next item starting with the buffer, case-insensitive', () => {
    expect(typeahead(items, 'm', 0)).toBe(2);
    expect(typeahead(items, 'DEL', 0)).toBe(5);
  });

  it('cycles through items when the same letter repeats', () => {
    expect(typeahead(items, 'h', 0)).toBe(4); // "Hide" is disabled
    expect(typeahead(items, 'hh', 4)).toBe(4);
    const many: MenuModelItem[] = [{ label: 'Apple' }, { label: 'Avocado' }, { label: 'Banana' }];
    expect(typeahead(many, 'a', 0)).toBe(1);
    expect(typeahead(many, 'aa', 1)).toBe(0);
  });

  it('keeps the current item when nothing matches', () => {
    expect(typeahead(items, 'zz', 2)).toBe(2);
  });

  it('a longer buffer matches from the current item', () => {
    expect(typeahead(items, 'ho', 0)).toBe(4);
  });
});
