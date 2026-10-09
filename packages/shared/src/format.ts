// The one place money becomes text (CLAUDE.md §9). Integer digit arithmetic only, no floats and
// no Intl: the plan's own number format decides separators, not the machine's locale.
import type { Minor } from './money.ts';

export interface MoneyFormat {
  /** Decimal places amounts are stored in (minor units). */
  decimals: number;
  /**
   * Decimal places shown, when the plan switched to a currency with other decimals. YNAB keeps the
   * stored value and only shows it differently ($370.01 shows as ¥370, and comes back on switching
   * back): fewer places round half away from zero, more places add zeros. Absent = decimals.
   */
  displayDecimals?: number;
  symbol: string;
  placement: 'before' | 'after' | 'none';
  /** YNAB's sample notation (NUMBER_FORMATS), adjusted to the currency's decimals. */
  numberFormat: string;
}

/** YNAB's Plan Settings number formats, in its order (checked 2026-10-09). */
export const NUMBER_FORMATS = ['123,456.78', '123.456,78', '123 456.78', "123'456.78", '123 456-78', '123 456,78', '123,456/78', '1,23,456.78'] as const;

/** Indian grouping ("1,23,456.78"): the last three digits, then pairs. */
function isLakh(sample: string): boolean {
  return /^1\D23\D456/.test(sample);
}

/** Group and decimal separators from a sample like '123,456.78' (group '' when there is none). */
export function numberFormatSeparators(sample: string): { group: string; decimal: string } {
  const lakh = /^1(?<g>\D)23\k<g>456(?:(\D)7\d*)?$/.exec(sample);
  if (lakh) return { group: lakh[1] ?? ',', decimal: lakh[2] ?? '.' };
  const m = /^123(\D?)456(?:(\D)7\d*)?$/.exec(sample);
  return { group: m?.[1] ?? ',', decimal: m?.[2] ?? '.' };
}

/** The sample for a currency with this many decimals: '123,456.78' → '123,456' (0) or '123,456.789' (3). */
export function numberFormatSample(sample: string, decimals: number): string {
  const { group, decimal } = numberFormatSeparators(sample);
  const whole = isLakh(sample) ? `1${group}23${group}456` : `123${group}456`;
  return decimals > 0 ? `${whole}${decimal}${'789012'.slice(0, decimals)}` : whole;
}

/**
 * Separators for typing an amount. A format whose decimal mark is an arithmetic sign
 * ('123 456-78', '123,456/78') takes '.' while typing, so "12.50-3" still subtracts.
 */
export function inputSeparators(sample: string): { decimal: string; group: string } {
  const { group, decimal } = numberFormatSeparators(sample);
  const safeDecimal = decimal === '-' || decimal === '/' ? '.' : decimal;
  return { decimal: safeDecimal, group: group === '' || group === safeDecimal ? ',' : group };
}

function groupDigits(digits: string, separator: string, lakh: boolean): string {
  if (separator === '') return digits;
  if (lakh && digits.length > 3) {
    const head = digits.slice(0, -3);
    const pairs: string[] = [];
    for (let end = head.length; end > 0; end -= 2) pairs.unshift(head.slice(Math.max(0, end - 2), end));
    return `${pairs.join(separator)}${separator}${digits.slice(-3)}`;
  }
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits.charAt(i);
  }
  return out;
}

export function formatMoney(amount: Minor, format: MoneyFormat): string {
  const { group, decimal } = numberFormatSeparators(format.numberFormat);
  const shown = format.displayDecimals ?? format.decimals;
  let value = Math.abs(amount);
  if (shown < format.decimals) {
    const step = 10 ** (format.decimals - shown);
    value = Math.floor(value / step) + (value % step >= step / 2 ? 1 : 0);
  } else if (shown > format.decimals) {
    value *= 10 ** (shown - format.decimals);
  }
  const negative = amount < 0 && value !== 0;
  const digits = String(value).padStart(shown + 1, '0');
  const whole = digits.slice(0, digits.length - shown);
  const fraction = shown > 0 ? decimal + digits.slice(digits.length - shown) : '';
  const number = groupDigits(whole, group, isLakh(format.numberFormat)) + fraction;
  // Before the number, a letter symbol ("CHF") gets a space and "$" doesn't; after it, no space
  // ("123.456,78kr", "25,67€": YNAB's Plan Settings and exports, 2026-10-09).
  const spaced = /\p{L}$/u.test(format.symbol);
  let text = number;
  if (format.placement === 'before' && format.symbol !== '') text = format.symbol + (spaced ? ' ' : '') + number;
  if (format.placement === 'after' && format.symbol !== '') text = `${number}${format.symbol}`;
  return negative ? `-${text}` : text;
}
