import { describe, expect, it } from 'vitest';
import { createOption, filterGroups, flatten, move, normalize, type ComboGroup } from './comboModel.ts';

const groups: ComboGroup[] = [
  {
    id: 'g1',
    label: 'Everyday',
    options: [
      { id: 'groceries', label: 'Groceries' },
      { id: 'gas', label: 'Gas & Transit' },
      { id: 'dining', label: 'Dining Out', keywords: ['restaurants'] },
    ],
  },
  {
    id: 'g2',
    label: 'Bills',
    options: [
      { id: 'mortgage', label: 'Mortgage' },
      { id: 'car', label: 'Car Insurance' },
      { id: 'old', label: 'Old Gym', disabled: true },
      { id: 'cafe', label: 'Café Société' },
    ],
  },
  { id: 'g3', label: 'Empty', options: [] },
];

describe('normalize', () => {
  it('folds case and diacritics', () => {
    expect(normalize('Café SOCIÉTÉ')).toBe('cafe societe');
  });
});

describe('filterGroups', () => {
  it('an empty query keeps everything except empty groups, in order', () => {
    const r = filterGroups(groups, '');
    expect(r.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(r[0]?.options.map((o) => o.id)).toEqual(['groceries', 'gas', 'dining']);
  });

  it('ranks starts-with, then word-start, then contains, within each group', () => {
    const r = filterGroups(groups, 'g');
    expect(r.map((g) => g.id)).toEqual(['g1', 'g2']);
    // "Groceries", "Gas & Transit" start with g; "Dining" contains g mid-word (Dinin_g_).
    expect(r[0]?.options.map((o) => o.id)).toEqual(['groceries', 'gas', 'dining']);
    // "Old Gym": word start (but disabled still listed); "Mortgage": contains.
    expect(r[1]?.options.map((o) => o.id)).toEqual(['old', 'mortgage']);
  });

  it('matches keywords and drops groups with no match', () => {
    const r = filterGroups(groups, 'restau');
    expect(r).toHaveLength(1);
    expect(r[0]?.options[0]?.id).toBe('dining');
    expect(r[0]?.options[0]?.match).toBeNull();
  });

  it('is diacritic- and case-insensitive and reports the matched range', () => {
    const r = filterGroups(groups, 'SOCIE');
    expect(r[0]?.options[0]).toMatchObject({ id: 'cafe', match: [5, 10] });
    const t = filterGroups(groups, 'tra');
    expect(t[0]?.options[0]).toMatchObject({ id: 'gas', match: [6, 9] });
  });
});

describe('flatten and move', () => {
  const list = flatten(filterGroups(groups, ''));

  it('flattens to selectable options in display order', () => {
    expect(list.map((o) => o.id)).toEqual(['groceries', 'gas', 'dining', 'mortgage', 'car', 'old', 'cafe']);
  });

  it('moves down and up, skipping disabled, without wrapping', () => {
    expect(move(list, null, 'ArrowDown')).toBe('groceries');
    expect(move(list, 'car', 'ArrowDown')).toBe('cafe');
    expect(move(list, 'cafe', 'ArrowDown')).toBe('cafe');
    expect(move(list, 'cafe', 'ArrowUp')).toBe('car');
    expect(move(list, 'groceries', 'ArrowUp')).toBe('groceries');
    expect(move(list, null, 'ArrowUp')).toBe('cafe');
  });

  it('Home, End and paging', () => {
    expect(move(list, 'car', 'Home')).toBe('groceries');
    expect(move(list, 'gas', 'End')).toBe('cafe');
    expect(move(list, 'groceries', 'PageDown', 3)).toBe('mortgage');
    // Paging counts selectable rows: the disabled "Old Gym" isn't one.
    expect(move(list, 'cafe', 'PageUp', 3)).toBe('dining');
    expect(move(list, 'gas', 'PageDown', 10)).toBe('cafe');
  });

  it('handles an empty list', () => {
    expect(move([], null, 'ArrowDown')).toBeNull();
  });
});

describe('createOption', () => {
  const existing = flatten(filterGroups(groups, ''));
  it('offers to create when nothing matches the label exactly', () => {
    expect(createOption('  Bakery  ', existing, 'payee')).toEqual({ id: '__create__', label: 'Create payee “Bakery”', createLabel: 'Bakery' });
  });
  it('not for an exact (case-insensitive) match or empty text', () => {
    expect(createOption('groceries', existing, 'payee')).toBeNull();
    expect(createOption('   ', existing, 'payee')).toBeNull();
  });
});
