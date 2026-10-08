/** A rule the data must always satisfy was broken (a bug or corrupted data). */
export class InvariantViolation extends Error {
  override readonly name = 'InvariantViolation';
}

/** Input the engine refuses (unknown ids, a categorized budget-to-budget transfer, …). */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}
