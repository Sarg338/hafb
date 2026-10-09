// Currencies for Plan Settings and New Plan (S7.1). YNAB lists "Name–CODE" and, on picking one,
// fills Currency Placement and Number Format with that currency's defaults. Defaults checked in
// YNAB (2026-10-09): USD $ before 123,456.78; EUR € before 123,456.78; JPY ¥ before 123,456;
// INR ₹ before 1,23,456.78; CHF "CHF" before 123'456.78; SEK kr after 123.456,78; KWD د.ك.
// before 123,456.789. ASSUMPTION: other currencies take their ICU symbol, before, 123,456.78.
import { CURRENCY_ROWS } from './currencyData.ts';
import { numberFormatSample } from './format.ts';

export interface Currency {
  /** ISO 4217. */
  code: string;
  name: string;
  /** The currency's own decimal places (ISO 4217). */
  decimals: number;
  symbol: string;
  placement: 'before' | 'after';
  /** A NUMBER_FORMATS sample adjusted to the decimals. */
  numberFormat: string;
}

const YNAB_DEFAULTS: Readonly<Record<string, Partial<Pick<Currency, 'name' | 'symbol' | 'placement' | 'numberFormat'>>>> = {
  GBP: { name: 'UK Pound Sterling' },
  INR: { numberFormat: '1,23,456.78' },
  CHF: { numberFormat: "123'456.78" },
  SEK: { placement: 'after', numberFormat: '123.456,78' },
  KWD: { symbol: 'د.ك.' },
};

export const CURRENCIES: readonly Currency[] = CURRENCY_ROWS.map(([code, name, decimals, symbol]) => {
  const own = YNAB_DEFAULTS[code] ?? {};
  return {
    code,
    name: own.name ?? name,
    decimals,
    symbol: own.symbol ?? symbol,
    placement: own.placement ?? 'before',
    numberFormat: numberFormatSample(own.numberFormat ?? '123,456.78', decimals),
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyByCode(code: string): Currency | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** YNAB's label: "US Dollar–USD". */
export function currencyLabel(c: Pick<Currency, 'name' | 'code'>): string {
  return `${c.name}–${c.code}`;
}

/** YNAB's Date Format choices, in its order. */
export const DATE_FORMATS = ['YYYY/MM/DD', 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY.MM.DD'] as const;
