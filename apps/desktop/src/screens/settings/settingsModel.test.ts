import { describe, expect, it } from 'vitest';
import { CURRENCY_GROUPS, dateFormatOptions, draftFrom, newPlanDraft, newPlanSettings, numberFormatOptions, placementOptions, settingsEdit, withCurrency } from './settingsModel.ts';

describe('Plan Settings dialog (S7.1, YNAB 2026-10-09)', () => {
  it("offers YNAB's placement labels with the plan's own symbol and format", () => {
    expect(placementOptions(newPlanDraft()).map((o) => o.label)).toEqual(['Before amount ($123,456.78)', 'After amount (123,456.78$)', 'Don’t show (123,456.78)']);
    const sek = withCurrency(newPlanDraft(), 'SEK');
    expect(placementOptions(sek)[1]?.label).toBe('After amount (123.456,78kr)');
    expect(placementOptions(withCurrency(newPlanDraft(), 'JPY'))[0]?.label).toBe('Before amount (¥123,456)');
    expect(placementOptions(withCurrency(newPlanDraft(), 'CHF'))[0]?.label).toBe("Before amount (CHF 123'456.78)");
  });

  it('picking a currency fills its placement, decimals and number format', () => {
    expect(withCurrency(newPlanDraft('Home'), 'SEK')).toEqual({ name: 'Home', currencyCode: 'SEK', currencySymbol: 'kr', placement: 'after', numberFormat: '123.456,78', dateFormat: 'MM/DD/YYYY', decimals: 2 });
    expect(withCurrency(newPlanDraft(), 'INR')).toMatchObject({ currencySymbol: '₹', numberFormat: '1,23,456.78' });
    expect(withCurrency(newPlanDraft(), 'KWD')).toMatchObject({ decimals: 3, numberFormat: '123,456.789' });
    expect(withCurrency(newPlanDraft(), 'XXX-not-real')).toEqual(newPlanDraft());
  });

  it('lists the eight number formats in the currency decimals and the seven date formats', () => {
    expect(numberFormatOptions(2).map((o) => o.label)).toEqual(['123,456.78', '123.456,78', '123 456.78', "123'456.78", '123 456-78', '123 456,78', '123,456/78', '1,23,456.78']);
    expect(numberFormatOptions(0).map((o) => o.label)).toEqual(['123,456', '123.456', '123 456', "123'456", '1,23,456']);
    expect(dateFormatOptions(2026).map((o) => o.label)).toEqual(['2026/12/30', '2026-12-30', '30-12-2026', '30/12/2026', '30.12.2026', '12/30/2026', '2026.12.30']);
  });

  it('currencies read "Name–CODE"', () => {
    const labels = CURRENCY_GROUPS[0]?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('US Dollar–USD');
    expect(labels).toContain('UK Pound Sterling–GBP');
    expect(labels.length).toBeGreaterThan(150);
  });

  it('an existing plan keeps its stored decimals; a new plan stores the currency decimals', () => {
    const s = { name: 'P', currencyCode: 'USD', currencyDecimals: 2, currencySymbol: '$', symbolPlacement: 'before' as const, numberFormat: '123,456.78', dateFormat: 'MM/DD/YYYY', createdAt: 'T' };
    const yen = withCurrency(draftFrom(s), 'JPY');
    expect(settingsEdit(yen)).toEqual({ name: 'P', currencyCode: 'JPY', currencySymbol: '¥', symbolPlacement: 'before', numberFormat: '123,456', dateFormat: 'MM/DD/YYYY', displayDecimals: 0 });
    expect(newPlanSettings({ ...yen, name: ' Yen plan ' })).toEqual({ name: 'Yen plan', currencyCode: 'JPY', currencyDecimals: 0, currencySymbol: '¥', symbolPlacement: 'before', numberFormat: '123,456', dateFormat: 'MM/DD/YYYY' });
    expect(draftFrom({ ...s, displayDecimals: 0 }).decimals).toBe(0);
  });
});
