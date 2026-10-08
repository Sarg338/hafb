// Amount fields accept arithmetic ("12.50+3", "100/3"), CLAUDE.md §6.4. Exact: every number is a
// BigInt fraction, and the result is rounded half away from zero exactly once, to the currency's
// minor unit. No floats anywhere (CLAUDE.md §1).
import { minor, type Minor } from './money.ts';

export interface AmountOptions {
  /** Digits after the decimal separator in this currency (2 for USD). */
  decimals: number;
  /** The plan's decimal separator; default '.'. */
  decimalSeparator?: string;
  /** The plan's group separator; default ','. Use ' ' for "1 234,56". */
  groupSeparator?: string;
}

export type AmountResult = { ok: true; value: Minor } | { ok: false; error: string };

interface Fraction {
  n: bigint;
  d: bigint;
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

function frac(n: bigint, d: bigint): Fraction {
  if (d < 0n) return frac(-n, -d);
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

type Token = { kind: 'num'; value: Fraction } | { kind: 'op'; value: '+' | '-' | '*' | '/' } | { kind: 'paren'; value: '(' | ')' };

class AmountError extends Error {}

function tokenize(text: string, decimal: string, group: string): Token[] {
  // Currency codes and words may wrap the amount ("USD 12", "12 kr"); letters inside are errors.
  const trimmed = text.replace(/^[\p{L}\s]+|[\p{L}\s]+$/gu, '');
  if (trimmed === '') throw new AmountError('Enter an amount');
  const tokens: Token[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed.charAt(i);
    if (/\p{Sc}/u.test(ch)) {
      i += 1;
      continue;
    }
    if (/\s/.test(ch) && group !== ' ') {
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
    } else if (ch === '*' || ch === '×') {
      tokens.push({ kind: 'op', value: '*' });
      i += 1;
    } else if (ch === '/' || ch === '÷') {
      tokens.push({ kind: 'op', value: '/' });
      i += 1;
    } else if (ch === '(' || ch === ')') {
      tokens.push({ kind: 'paren', value: ch });
      i += 1;
    } else if (/\d/.test(ch) || ch === decimal) {
      let whole = '';
      let fraction: string | null = null;
      while (i < trimmed.length) {
        const c = trimmed.charAt(i);
        if (/\d/.test(c)) {
          if (fraction === null) whole += c;
          else fraction += c;
        } else if (c === decimal) {
          if (fraction !== null) throw new AmountError('Two decimal points in one number');
          fraction = '';
        } else if (c === group && fraction === null && /\d/.test(trimmed.charAt(i + 1))) {
          // A group separator only between digits of the whole part.
        } else {
          break;
        }
        i += 1;
      }
      if (whole === '' && (fraction === null || fraction === '')) throw new AmountError(`"${text}" isn't a number`);
      const digits = `${whole}${fraction ?? ''}`;
      tokens.push({ kind: 'num', value: frac(BigInt(digits === '' ? '0' : digits), 10n ** BigInt((fraction ?? '').length)) });
    } else if (/\s/.test(ch)) {
      i += 1;
    } else {
      throw new AmountError(`"${ch}" can't be used in an amount`);
    }
  }
  return tokens;
}

function parse(tokens: Token[]): Fraction {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const unary = (): Fraction => {
    const t = peek();
    if (!t) throw new AmountError('The amount ends too early');
    if (t.kind === 'op' && t.value === '-') {
      pos += 1;
      const v = unary();
      return { n: -v.n, d: v.d };
    }
    if (t.kind === 'op' && t.value === '+') {
      pos += 1;
      return unary();
    }
    if (t.kind === 'paren' && t.value === '(') {
      pos += 1;
      const v = expr();
      const close = peek();
      if (close?.kind !== 'paren' || close.value !== ')') throw new AmountError('A "(" is missing its ")"');
      pos += 1;
      return v;
    }
    if (t.kind === 'num') {
      pos += 1;
      return t.value;
    }
    throw new AmountError('An operator is missing a number');
  };

  const term = (): Fraction => {
    let v = unary();
    for (let t = peek(); t?.kind === 'op' && (t.value === '*' || t.value === '/'); t = peek()) {
      pos += 1;
      const r = unary();
      if (t.value === '*') v = frac(v.n * r.n, v.d * r.d);
      else {
        if (r.n === 0n) throw new AmountError("Can't divide by zero");
        v = frac(v.n * r.d, v.d * r.n);
      }
    }
    return v;
  };

  const expr = (): Fraction => {
    let v = term();
    for (let t = peek(); t?.kind === 'op' && (t.value === '+' || t.value === '-'); t = peek()) {
      pos += 1;
      const r = term();
      v = t.value === '+' ? frac(v.n * r.d + r.n * v.d, v.d * r.d) : frac(v.n * r.d - r.n * v.d, v.d * r.d);
    }
    return v;
  };

  const result = expr();
  if (pos !== tokens.length) {
    const extra = tokens[pos];
    throw new AmountError(extra?.kind === 'paren' ? 'A ")" has no matching "("' : 'Two numbers need an operator between them');
  }
  return result;
}

/** Evaluate an amount or a sum ("12.50+3") to minor units, exactly. */
export function evaluateAmount(text: string, options: AmountOptions): AmountResult {
  const decimal = options.decimalSeparator ?? '.';
  const group = options.groupSeparator ?? ',';
  try {
    const v = parse(tokenize(text, decimal, group));
    // value × 10^decimals, rounded half away from zero.
    const scaled = abs(v.n) * 10n ** BigInt(options.decimals);
    const rounded = (2n * scaled + v.d) / (2n * v.d);
    const signed = v.n < 0n ? -rounded : rounded;
    if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < -BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ok: false, error: 'That amount is too large' };
    }
    return { ok: true, value: minor(Number(signed)) };
  } catch (e) {
    if (e instanceof AmountError) return { ok: false, error: e.message };
    throw e;
  }
}

/** True when the text is a calculation rather than a plain number (show a result preview). */
export function hasArithmetic(text: string): boolean {
  return /[+*×/÷()]|\d\s*-/.test(text.trim().replace(/^[-\s]+/, ''));
}
