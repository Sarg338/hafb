// Plan Settings (S7.1): YNAB's dialog (Plan Name, Currency, Currency Placement, Number Format,
// Date Format; checked 2026-10-09). A currency switch keeps every stored amount: amounts stay in
// the plan's original decimals and `displayDecimals` says how many to show, as YNAB does.
import { ValidationError } from '@hafb/engine';
import { currencyByCode, DATE_FORMATS, numberFormatSeparators } from '@hafb/shared';
import { deepEqual } from '../changes.ts';
import type { PlanData, PlanSettings, SymbolPlacement } from '../records.ts';
import { omit, requireName, type Command, type CommandContext } from './context.ts';

export interface PlanSettingsEdit {
  name?: string;
  currencyCode?: string;
  currencySymbol?: string;
  symbolPlacement?: SymbolPlacement;
  numberFormat?: string;
  dateFormat?: string;
  /** Decimals to show; the stored decimals never change. */
  displayDecimals?: number;
}

/** What picking a currency fills in (YNAB: the currency's own symbol, placement and number format). */
export function planSettingsFor(code: string): Required<Pick<PlanSettingsEdit, 'currencyCode' | 'currencySymbol' | 'symbolPlacement' | 'numberFormat' | 'displayDecimals'>> {
  const c = currencyByCode(code);
  if (!c) throw new ValidationError(`Unknown currency: ${code}`);
  return { currencyCode: c.code, currencySymbol: c.symbol, symbolPlacement: c.placement, numberFormat: c.numberFormat, displayDecimals: c.decimals };
}

function validNumberFormat(sample: string): boolean {
  // Round-trips through the separator reader: "123,456.78"-shaped, with or without decimals.
  const { group, decimal } = numberFormatSeparators(sample);
  return /^(123|1\D23)\D?456(\D7\d*)?$/.test(sample) && !(group !== '' && group === decimal);
}

export function editPlanSettings(plan: PlanData, _ctx: CommandContext, edit: PlanSettingsEdit): Command {
  const s = plan.settings;
  const next: PlanSettings = { ...s };
  if (edit.name !== undefined) next.name = requireName(edit.name, 'Plan');
  if (edit.currencyCode !== undefined) {
    if (!currencyByCode(edit.currencyCode)) throw new ValidationError(`Unknown currency: ${edit.currencyCode}`);
    next.currencyCode = edit.currencyCode.toUpperCase();
  }
  if (edit.currencySymbol !== undefined) next.currencySymbol = edit.currencySymbol;
  if (edit.symbolPlacement !== undefined) next.symbolPlacement = edit.symbolPlacement;
  if (edit.numberFormat !== undefined) {
    if (!validNumberFormat(edit.numberFormat)) throw new ValidationError(`Not a number format: "${edit.numberFormat}"`);
    next.numberFormat = edit.numberFormat;
  }
  if (edit.dateFormat !== undefined) {
    if (!DATE_FORMATS.some((f) => f === edit.dateFormat)) throw new ValidationError(`Not a date format: "${edit.dateFormat}"`);
    next.dateFormat = edit.dateFormat;
  }
  let settings = next;
  if (edit.displayDecimals !== undefined) {
    if (!Number.isInteger(edit.displayDecimals) || edit.displayDecimals < 0 || edit.displayDecimals > 4) throw new ValidationError('Decimals must be 0 to 4');
    settings = edit.displayDecimals === s.currencyDecimals ? omit(next, 'displayDecimals') : { ...next, displayDecimals: edit.displayDecimals };
  }
  return { label: 'Edit plan settings', changes: deepEqual(s, settings) ? {} : { settings } };
}
