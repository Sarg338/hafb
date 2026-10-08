// The one place money becomes text (CLAUDE.md §9). Integer digit arithmetic only, no floats and
// no Intl: the plan's own number format decides separators, not the machine's locale.
import type { Minor } from './money.ts';

export interface MoneyFormat {
  decimals: number;
  symbol: string;
  placement: 'before' | 'after' | 'none';
  /** YNAB's sample notation: '123,456.78', '123.456,78', '123 456,78', "123'456.78", '123456.78'. */
  numberFormat: string;
}

/** Group and decimal separators from a sample like '123,456.78' (group '' when there is none). */
export function numberFormatSeparators(sample: string): { group: string; decimal: string } {
  const m = /^123(\D?)456(?:(\D)78\d*)?$/.exec(sample) ?? /^123(\D?)456(\D)789$/.exec(sample);
  return { group: m?.[1] ?? ',', decimal: m?.[2] ?? '.' };
}

function groupDigits(digits: string, separator: string): string {
  if (separator === '') return digits;
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits.charAt(i);
  }
  return out;
}

export function formatMoney(amount: Minor, format: MoneyFormat): string {
  const { group, decimal } = numberFormatSeparators(format.numberFormat);
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(format.decimals + 1, '0');
  const whole = digits.slice(0, digits.length - format.decimals);
  const fraction = format.decimals > 0 ? decimal + digits.slice(digits.length - format.decimals) : '';
  const number = groupDigits(whole, group) + fraction;
  // A letter symbol ("CHF", "kr") gets a space; "$" and "€"-before don't. After the number: always a space.
  const spaced = /\p{L}$/u.test(format.symbol);
  let text = number;
  if (format.placement === 'before' && format.symbol !== '') text = format.symbol + (spaced ? ' ' : '') + number;
  if (format.placement === 'after' && format.symbol !== '') text = `${number} ${format.symbol}`;
  return negative ? `-${text}` : text;
}
