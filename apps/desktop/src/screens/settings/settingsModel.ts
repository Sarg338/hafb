// Plan Settings and New Plan (S7.1), pure. YNAB's dialog (checked 2026-10-09): Plan Name, Currency
// ("US Dollar–USD"), Currency Placement ("Before amount ($123,456.78)", "After amount
// (123,456.78$)", "Don't show (123,456.78)"), Number Format (eight samples, shown with the
// currency's decimals), Date Format (seven, shown as 12/30/2026). Picking a currency fills its
// placement and number format.
import {
  CURRENCIES,
  currencyByCode,
  currencyLabel,
  DATE_FORMATS,
  formatDate,
  formatMoney,
  makeDate,
  minor,
  NUMBER_FORMATS,
  numberFormatSample,
} from '@hafb/shared';
import type { PlanSettings, PlanSettingsEdit, SymbolPlacement } from '@hafb/store';

/** What the dialog edits. `decimals` = the decimals shown (the currency's own). */
export interface SettingsDraft {
  name: string;
  currencyCode: string;
  currencySymbol: string;
  placement: SymbolPlacement;
  numberFormat: string;
  dateFormat: string;
  decimals: number;
}

export function draftFrom(s: PlanSettings): SettingsDraft {
  return {
    name: s.name,
    currencyCode: s.currencyCode,
    currencySymbol: s.currencySymbol,
    placement: s.symbolPlacement,
    numberFormat: s.numberFormat,
    dateFormat: s.dateFormat,
    decimals: s.displayDecimals ?? s.currencyDecimals,
  };
}

/** YNAB's New Plan defaults: US Dollar, before, 123,456.78, 12/30/2026. */
export function newPlanDraft(name = ''): SettingsDraft {
  const usd = currencyByCode('USD');
  return { name, currencyCode: 'USD', currencySymbol: usd?.symbol ?? '$', placement: 'before', numberFormat: '123,456.78', dateFormat: 'MM/DD/YYYY', decimals: 2 };
}

/** Picking a currency: its symbol, placement, decimals and number format (in the current style's family when it has one). */
export function withCurrency(d: SettingsDraft, code: string): SettingsDraft {
  const c = currencyByCode(code);
  if (!c) return d;
  return { ...d, currencyCode: c.code, currencySymbol: c.symbol, placement: c.placement, numberFormat: c.numberFormat, decimals: c.decimals };
}

/** "Before amount ($123,456.78)" etc., with the draft's symbol, number format and decimals. */
export function placementOptions(d: SettingsDraft): { id: SymbolPlacement; label: string }[] {
  // 123456.78 in the draft's decimals: 123456 (0), 12345678 (2), 123456789 (3).
  const sample = minor(Number(`123456${'789012'.slice(0, d.decimals)}`));
  const at = (placement: SymbolPlacement) => formatMoney(sample, { decimals: d.decimals, symbol: d.currencySymbol, placement, numberFormat: d.numberFormat });
  return [
    { id: 'before', label: `Before amount (${at('before')})` },
    { id: 'after', label: `After amount (${at('after')})` },
    { id: 'none', label: `Don’t show (${at('none')})` },
  ];
}

/** The eight number formats, as samples with the draft's decimals ("123,456" for yen; formats that then look the same appear once). */
export function numberFormatOptions(decimals: number): { id: string; label: string }[] {
  const samples = [...new Set(NUMBER_FORMATS.map((f) => numberFormatSample(f, decimals)))];
  return samples.map((s) => ({ id: s, label: s }));
}

/** YNAB shows each date format as December 30 of this year. */
export function dateFormatOptions(year: number): { id: string; label: string }[] {
  const sample = makeDate(year, 12, 30);
  return DATE_FORMATS.map((f) => ({ id: f, label: formatDate(sample, f) }));
}

export const CURRENCY_GROUPS = [{ id: 'currencies', label: 'Currency', options: CURRENCIES.map((c) => ({ id: c.code, label: currencyLabel(c) })) }];

/** The store edit for an existing plan (stored decimals never change). */
export function settingsEdit(d: SettingsDraft): PlanSettingsEdit {
  return {
    name: d.name,
    currencyCode: d.currencyCode,
    currencySymbol: d.currencySymbol,
    symbolPlacement: d.placement,
    numberFormat: d.numberFormat,
    dateFormat: d.dateFormat,
    displayDecimals: d.decimals,
  };
}

/** A new plan's settings (the session adds its dates): it stores amounts in the currency's own decimals. */
export function newPlanSettings(d: SettingsDraft): Omit<PlanSettings, 'createdAt' | 'firstMonth'> {
  return {
    name: d.name.trim(),
    currencyCode: d.currencyCode,
    currencyDecimals: d.decimals,
    currencySymbol: d.currencySymbol,
    symbolPlacement: d.placement,
    numberFormat: d.numberFormat,
    dateFormat: d.dateFormat,
  };
}
