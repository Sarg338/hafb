/**
 * HAFB budget engine. Pure: snapshot in, computed state out. No I/O, no clock, no randomness.
 * Rules: CLAUDE.md §5. Worked examples: docs/budget-math.md.
 */
export * from './model.ts';
export * from './errors.ts';
export * from './budget.ts';
export * from './ynab/csv.ts';
export * from './ynab/toSnapshot.ts';
