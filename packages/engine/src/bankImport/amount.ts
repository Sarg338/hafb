// Bank amounts with more decimal places than the currency has. Public sample exports write them:
// Fidelity "+00000000000115.8331", others "-30.000". Extra places round half away from zero to the
// currency's places, in integer math (CLAUDE.md: rounding rules explicit and tested). OFX and QIF
// only; a CSV keeps the strict parse so a wrong decimal separator shows up as a row error.
import { divRound, type Minor } from '@hafb/shared';
import { parseAmount } from '../ynab/csv.ts';

export function parseBankAmount(text: string, decimalSeparator: '.' | ',', decimals: number): Minor {
  const fraction = (text.split(decimalSeparator)[1] ?? '').replace(/\D+$/, '');
  const format = { decimalSeparator };
  if (fraction.length <= decimals) return parseAmount(text, format, decimals);
  return divRound(parseAmount(text, format, fraction.length), 10 ** (fraction.length - decimals));
}
