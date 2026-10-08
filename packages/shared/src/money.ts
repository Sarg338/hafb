/**
 * Money is always an integer count of the currency's minor unit (cents for USD). Never a float.
 * Every helper checks its result is a safe integer, so overflow throws instead of silently
 * losing cents.
 */
export type Minor = number & { readonly __brand: 'Minor' };

function isMinorValue(value: number): value is Minor {
  return Number.isSafeInteger(value);
}

/**
 * Brand an integer as a minor-unit amount. Throws on fractions, NaN, or unsafe integers.
 * Normalizes -0 to 0: SQLite stores both as 0, and a stray -0 (e.g. `neg(ZERO)`) would make an
 * in-memory record differ from the same record read back from the file.
 */
export function minor(value: number): Minor {
  const v = value === 0 ? 0 : value;
  if (!isMinorValue(v)) {
    throw new RangeError(`Not a safe integer minor-unit amount: ${String(value)}`);
  }
  return v;
}

export const ZERO: Minor = minor(0);

export function add(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

export function neg(a: Minor): Minor {
  return minor(a === 0 ? 0 : 0 - a);
}

export function abs(a: Minor): Minor {
  return minor(Math.abs(a));
}

/** Multiply by an integer factor (counts, months). */
export function mul(a: Minor, factor: number): Minor {
  if (!Number.isSafeInteger(factor)) {
    throw new RangeError(`mul factor must be an integer: ${String(factor)}`);
  }
  return minor(a * factor);
}

export function sum(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return minor(total);
}

export function minOf(a: Minor, b: Minor): Minor {
  return a < b ? a : b;
}

export function maxOf(a: Minor, b: Minor): Minor {
  return a > b ? a : b;
}

/** max(a, 0) */
export function positivePart(a: Minor): Minor {
  return a > 0 ? a : ZERO;
}

/**
 * Integer division rounded to the nearest minor unit, ties rounded **half away from zero**
 * (CLAUDE.md §5.5 "round-half-up", applied to magnitude so +2.5 → 3 and −2.5 → −3).
 */
export function divRound(numerator: Minor, divisor: number): Minor {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new RangeError(`divRound divisor must be a positive integer: ${String(divisor)}`);
  }
  const negative = numerator < 0;
  const n = Math.abs(numerator);
  const q = Math.floor(n / divisor);
  const r = n - q * divisor;
  const rounded = r * 2 >= divisor ? q + 1 : q;
  return minor(negative ? -rounded : rounded);
}

/**
 * Split `total` into `parts` integer pieces that differ by at most one minor unit and sum
 * exactly to `total`. Earlier pieces receive the remainder.
 */
export function splitEvenly(total: Minor, parts: number): Minor[] {
  if (!Number.isSafeInteger(parts) || parts <= 0) {
    throw new RangeError(`splitEvenly parts must be a positive integer: ${String(parts)}`);
  }
  const negative = total < 0;
  const n = Math.abs(total);
  const base = Math.floor(n / parts);
  let remainder = n - base * parts;
  const out: Minor[] = [];
  for (let i = 0; i < parts; i += 1) {
    const piece = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    out.push(minor(negative ? -piece : piece));
  }
  return out;
}

/**
 * Parse a plain decimal string ("1234.5", "-0.07", "12") into minor units for a currency with
 * `decimals` digits. No floats are involved: the digits are processed as text. Throws on
 * malformed input or more fractional digits than the currency allows.
 */
export function parseDecimal(text: string, decimals: number): Minor {
  const match = /^([+-])?(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) {
    throw new RangeError(`Not a decimal amount: "${text}"`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  if (fraction.length > decimals) {
    throw new RangeError(`"${text}" has more than ${String(decimals)} decimal places`);
  }
  const digits = whole + fraction.padEnd(decimals, '0');
  const value = Number(digits);
  return minor(value === 0 ? 0 : sign * value);
}
