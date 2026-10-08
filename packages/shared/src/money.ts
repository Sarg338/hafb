/**
 * Money is always an integer count of the currency's minor unit (cents for USD).
 * Never a float. Arithmetic helpers (add/sub/mul/divRound) arrive in Phase 1
 * together with their tests.
 */
export type Minor = number & { readonly __brand: 'Minor' };

function isMinorValue(value: number): value is Minor {
  return Number.isSafeInteger(value);
}

/** Brand an integer as a minor-unit amount. Throws on fractions, NaN, or unsafe integers. */
export function minor(value: number): Minor {
  if (!isMinorValue(value)) {
    throw new RangeError(`Not a safe integer minor-unit amount: ${String(value)}`);
  }
  return value;
}
