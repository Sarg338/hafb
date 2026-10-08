// ynabExportToSnapshot on a tiny synthetic export (the golden tests cover real exports, local only).
import { asISODate } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { parseYnabPlan, parseYnabRegister, READY_TO_ASSIGN, ynabExportToSnapshot } from '../src/index.ts';

const PLAN = [
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
  '"Oct 2026","Bills: Rent","Bills","Rent",$100.00,-$100.00,$0.00',
  '"Oct 2026","Bills: Food","Bills","Food",$50.00,-$30.00,$20.00',
].join('\n');

const REGISTER = [
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  '"Checking","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$500.00,"Cleared"',
  '"Checking","Red","10/02/2026","Landlord","Bills: Rent","Bills","Rent","Oct",$100.00,$0.00,"Reconciled"',
  '"Checking","","10/03/2026","Market","Bills: Food","Bills","Food","Split (1/2) veg",$20.00,$0.00,"Uncleared"',
  '"Checking","","10/03/2026","Market","Bills: Food","Bills","Food","Split (2/2) ",$10.00,$0.00,"Uncleared"',
  '"Checking","","11/01/2026","Landlord","Bills: Rent","Bills","Rent","",$100.00,$0.00,"Uncleared"',
].join('\n');

describe('ynabExportToSnapshot', () => {
  const result = ynabExportToSnapshot(parseYnabPlan(PLAN), parseYnabRegister(REGISTER), { today: asISODate('2026-10-08') });

  it('keeps the source register rows behind every transaction, split lines in order', () => {
    const { transactions } = result.snapshot;
    expect(transactions).toHaveLength(3);
    for (const t of transactions) expect(result.sourceRows[t.id]).toBeDefined();
    const [start, rent, split] = transactions;
    expect(start?.categoryId).toBe(READY_TO_ASSIGN);
    expect(start?.isStartingBalance).toBe(true);
    expect(result.sourceRows[rent?.id ?? '']?.map((r) => [r.payee, r.flag, r.memo])).toEqual([['Landlord', 'Red', 'Oct']]);
    expect(split?.subtransactions?.map((s) => [s.amount, s.memo])).toEqual([
      [-2000, 'veg'],
      [-1000, undefined],
    ]);
    expect(result.sourceRows[split?.id ?? '']?.map((r) => r.memo)).toEqual(['Split (1/2) veg', 'Split (2/2) ']);
  });

  it('rows after today are returned as scheduled, not transactions', () => {
    expect(result.scheduled.map((r) => r.date)).toEqual(['2026-11-01']);
  });
});
