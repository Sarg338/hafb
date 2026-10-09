// Plan Settings (S7.1): YNAB's dialog edits the name, currency, placement, number and date formats.
// Switching currency keeps every stored amount and only changes how it shows (YNAB trial
// 2026-10-09: $3,070.00 showed as ¥3,070, $370.01 as ¥370, and the cents came back on switching back).
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@hafb/engine';
import { applyChanges } from '../src/changes.ts';
import { addTransaction, createAccount, editPlanSettings, planSettingsFor } from '../src/commands/index.ts';
import { Bench, blankPlan, makeCtx, usd } from './helpers/harness.ts';

describe('Plan Settings (S7.1)', () => {
  const setup = () => {
    const ctx = makeCtx();
    const b = new Bench(blankPlan(ctx));
    const acct = b.run(createAccount(b.plan, ctx, { name: 'Checking', type: 'checking', startingBalance: usd(3070), date: '2026-10-01' })).accountId;
    b.run(addTransaction(b.plan, ctx, { accountId: acct, date: '2026-10-02', amount: usd(-370.01), payeeName: 'Shop', categoryId: null }));
    return { ctx, b };
  };

  it('renames the plan and changes formats in one undoable step', () => {
    const { ctx, b } = setup();
    const before = b.plan.settings;
    const cmd = editPlanSettings(b.plan, ctx, { name: '  Household  ', numberFormat: '123.456,78', dateFormat: 'DD.MM.YYYY', symbolPlacement: 'after' });
    expect(cmd.label).toBe('Edit plan settings');
    const applied = applyChanges(b.plan, cmd.changes);
    expect(applied.plan.settings).toMatchObject({ name: 'Household', numberFormat: '123.456,78', dateFormat: 'DD.MM.YYYY', symbolPlacement: 'after' });
    expect(applyChanges(applied.plan, applied.inverse).plan.settings).toEqual(before);
    b.run(cmd);
  });

  it('a currency with other decimals keeps the stored amounts and only changes what shows', () => {
    const { ctx, b } = setup();
    const amounts = b.plan.transactions.map((t) => t.amount);
    b.run(editPlanSettings(b.plan, ctx, planSettingsFor('JPY')));
    expect(b.plan.settings).toMatchObject({ currencyCode: 'JPY', currencySymbol: '¥', currencyDecimals: 2, displayDecimals: 0, numberFormat: '123,456', symbolPlacement: 'before' });
    expect(b.plan.transactions.map((t) => t.amount)).toEqual(amounts);
    // Back to dollars: the cents were never lost.
    b.run(editPlanSettings(b.plan, ctx, planSettingsFor('USD')));
    expect(b.plan.settings.displayDecimals).toBeUndefined();
    expect(b.plan.settings).toMatchObject({ currencyCode: 'USD', currencySymbol: '$', numberFormat: '123,456.78' });
    expect(b.plan.transactions.map((t) => t.amount)).toEqual(amounts);
  });

  it("picking a currency fills YNAB's defaults for it", () => {

    expect(planSettingsFor('SEK')).toEqual({ currencyCode: 'SEK', currencySymbol: 'kr', symbolPlacement: 'after', numberFormat: '123.456,78', displayDecimals: 2 });
    expect(planSettingsFor('INR')).toMatchObject({ currencySymbol: '₹', numberFormat: '1,23,456.78' });
    expect(planSettingsFor('KWD')).toMatchObject({ numberFormat: '123,456.789', displayDecimals: 3 });
  });

  it('refuses an empty name, an unknown currency and a format it cannot show', () => {
    const { ctx, b } = setup();
    expect(() => editPlanSettings(b.plan, ctx, { name: ' ' })).toThrow(ValidationError);
    expect(() => editPlanSettings(b.plan, ctx, { currencyCode: 'XYZ' })).toThrow(ValidationError);
    expect(() => editPlanSettings(b.plan, ctx, { numberFormat: '12-34' })).toThrow(ValidationError);
    expect(() => editPlanSettings(b.plan, ctx, { dateFormat: 'DD/MM' })).toThrow(ValidationError);
    expect(() => editPlanSettings(b.plan, ctx, { displayDecimals: 5 })).toThrow(ValidationError);
  });

  it('nothing changed is no change', () => {
    const { ctx, b } = setup();
    expect(editPlanSettings(b.plan, ctx, { name: b.plan.settings.name }).changes).toEqual({});
  });
});
