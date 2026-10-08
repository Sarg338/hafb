// UUIDv7 (RFC 9562 §5.7): 48-bit Unix milliseconds, version 7, 12 random bits, variant 10, 62 random
// bits. Time-sortable as text. Pure: the caller supplies the clock and the random bytes.

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');

/** `random` must hold at least 10 bytes; only the first 10 are used (74 bits after masking). */
export function uuidv7(unixMs: number, random: Uint8Array): string {
  if (!Number.isSafeInteger(unixMs) || unixMs < 0 || unixMs >= 2 ** 48) {
    throw new RangeError(`uuidv7: timestamp out of range: ${String(unixMs)}`);
  }
  if (random.length < 10) throw new RangeError('uuidv7: need at least 10 random bytes');
  const r = (i: number): number => random[i] ?? 0;
  const timeHigh = Math.floor(unixMs / 2 ** 16);
  const timeLow = unixMs % 2 ** 16;
  const randA = ((r(0) & 0x0f) << 8) | r(1);
  const randB = ((r(2) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex(r(3), 2);
  let tail = '';
  for (let i = 4; i < 10; i++) tail += hex(r(i), 2);
  return `${hex(timeHigh, 8)}-${hex(timeLow, 4)}-7${hex(randA, 3)}-${randB}-${tail}`;
}

/**
 * A monotonic UUIDv7 source (RFC 9562 §6.2 method 1): within one millisecond the 12-bit rand_a
 * field is a counter, so ids made in a burst (an import of 20k rows) still sort in creation order,
 * which the engine uses as entry order. The clock and randomness are injected.
 */
export function uuidv7Generator(clock: () => number, randomBytes: (n: number) => Uint8Array): () => string {
  let lastMs = -1;
  let counter = 0;
  return () => {
    let ms = clock();
    if (ms <= lastMs) {
      ms = lastMs;
      counter += 1;
      if (counter > 0xfff) {
        ms = lastMs + 1;
        counter = 0;
      }
    } else {
      // Start low in the counter range so a burst has room before borrowing the next millisecond.
      counter = (randomBytes(1)[0] ?? 0) & 0x3ff;
    }
    lastMs = ms;
    const random = randomBytes(10);
    const bytes = new Uint8Array(10);
    bytes.set(random.subarray(0, 10));
    bytes[0] = (counter >> 8) & 0x0f;
    bytes[1] = counter & 0xff;
    return uuidv7(ms, bytes);
  };
}
