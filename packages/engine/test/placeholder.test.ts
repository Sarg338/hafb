import { describe, expect, it } from 'vitest';
import { ENGINE_API_VERSION } from '../src/index.ts';

describe('engine placeholder', () => {
  it('exists and has no budget logic yet', () => {
    expect(ENGINE_API_VERSION).toBe(0);
  });
});
