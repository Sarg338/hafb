import { describe, expect, it } from 'vitest';
import { shouldMoveFocus } from './focusRoute.ts';

describe('shouldMoveFocus', () => {
  it('not on first render', () => {
    expect(shouldMoveFocus(null, '/plan', false)).toBe(false);
  });

  it('on a real route change', () => {
    expect(shouldMoveFocus('/plan', '/reflect', false)).toBe(true);
  });

  it('not when the route did not change', () => {
    expect(shouldMoveFocus('/plan', '/plan', false)).toBe(false);
  });

  it('never steals focus from a field being typed in', () => {
    expect(shouldMoveFocus('/plan', '/reflect', true)).toBe(false);
  });
});
