import { describe, expect, it } from 'vitest';
import { InvariantViolation, ValidationError } from '@hafb/engine';
import { createDeduper, describeError, errorDetails } from './errors.ts';

describe('describeError', () => {
  it('validation errors keep the engine message and are recoverable', () => {
    const d = describeError(new ValidationError('Move amount must be positive'));
    expect(d).toMatchObject({ kind: 'validation', recoverable: true, message: 'Move amount must be positive' });
    expect(d.title).toBeTruthy();
  });

  it('invariant violations say the change was stopped to protect the plan', () => {
    const d = describeError(new InvariantViolation('Split lines do not add up'));
    expect(d.kind).toBe('invariant');
    expect(d.recoverable).toBe(false);
    expect(d.message).toMatch(/protect/i);
    expect(d.message).toContain('Split lines do not add up');
  });

  it.each([
    ['AlreadyOpen', /another window/i],
    ['NewerVersion', /newer version/i],
    ['NotAPlan', /isn.t a plan/i],
    ['NotOpen', /no plan is open/i],
    ['Io', /file/i],
    ['Sqlite', /plan file/i],
    ['Invalid', /couldn.t be saved/i],
  ])('store error %s', (kind, title) => {
    const d = describeError({ kind, message: 'detail from Rust' });
    expect(d.kind).toBe('store');
    expect(d.title).toMatch(title);
    expect(d.message.length).toBeGreaterThan(0);
  });

  it('store errors that are user mistakes are recoverable; I/O and database ones say nothing was lost', () => {
    expect(describeError({ kind: 'AlreadyOpen', message: 'x' }).recoverable).toBe(true);
    expect(describeError({ kind: 'Io', message: 'Access is denied.' }).message).toContain('Access is denied.');
  });

  it('an unknown store kind is still a store error', () => {
    expect(describeError({ kind: 'Mystery', message: 'odd' })).toMatchObject({ kind: 'store', message: expect.stringContaining('odd') as unknown });
  });

  it('unexpected errors, strings and junk all describe safely', () => {
    expect(describeError(new TypeError('x is undefined'))).toMatchObject({ kind: 'unexpected', recoverable: true });
    expect(describeError('plain text').message).toContain('plain text');
    expect(describeError(null).kind).toBe('unexpected');
    expect(describeError({ weird: true }).kind).toBe('unexpected');
  });
});

describe('errorDetails', () => {
  it('includes name, message and stack when present', () => {
    const e = new ValidationError('bad');
    const text = errorDetails(e);
    expect(text).toContain('ValidationError');
    expect(text).toContain('bad');
  });

  it('serialises non-errors', () => {
    expect(errorDetails({ kind: 'Io', message: 'm' })).toContain('"kind": "Io"');
  });
});

describe('createDeduper', () => {
  it('drops the same error within the window and lets it through after', () => {
    const seen = createDeduper(5000);
    expect(seen('a', 0)).toBe(true);
    expect(seen('a', 4999)).toBe(false);
    expect(seen('b', 4999)).toBe(true);
    expect(seen('a', 10_000)).toBe(true);
  });
});
