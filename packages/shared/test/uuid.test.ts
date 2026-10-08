import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Generator } from '../src/uuid.ts';

const bytes = (fill: number): Uint8Array => new Uint8Array(10).fill(fill);

describe('uuidv7 (RFC 9562)', () => {
  it('formats 8-4-4-4-12 lowercase hex', () => {
    expect(uuidv7(1760000000000, bytes(0xab))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('puts the 48-bit millisecond timestamp first', () => {
    const id = uuidv7(0x0123456789ab, bytes(0));
    expect(id.slice(0, 13)).toBe('01234567-89ab');
  });

  it('sets version 7 and variant 10 regardless of the random bytes', () => {
    for (const fill of [0x00, 0xff, 0x5a]) {
      const id = uuidv7(1, bytes(fill));
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
    expect(uuidv7(0, bytes(0))).toBe('00000000-0000-7000-8000-000000000000');
    expect(uuidv7(0, bytes(0xff))).toBe('00000000-0000-7fff-bfff-ffffffffffff');
  });

  it('sorts by time', () => {
    const ids = [3, 1, 1000, 2 ** 40, 2].map((ms) => uuidv7(ms, bytes(0xff)));
    const byTime = [1, 2, 3, 1000, 2 ** 40].map((ms) => uuidv7(ms, bytes(0)));
    expect([...ids].sort().map((s) => s.slice(0, 13))).toEqual(byTime.map((s) => s.slice(0, 13)));
  });

  it('rejects bad input', () => {
    expect(() => uuidv7(-1, bytes(0))).toThrow();
    expect(() => uuidv7(1.5, bytes(0))).toThrow();
    expect(() => uuidv7(2 ** 48, bytes(0))).toThrow();
    expect(() => uuidv7(0, new Uint8Array(9))).toThrow();
  });
});

describe('uuidv7Generator', () => {
  it('stays in creation order within one millisecond and across clock steps back', () => {
    let seed = 7;
    const rnd = (n: number): Uint8Array => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        out[i] = seed & 0xff;
      }
      return out;
    };
    const times = [5, 5, 5, 4, 6, 6, 100];
    let t = 0;
    const next = uuidv7Generator(() => times[Math.min(t++, times.length - 1)] ?? 0, rnd);
    const ids = Array.from({ length: 6000 }, () => next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
