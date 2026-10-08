import { describe, expect, it } from 'vitest';
import { shortcutKeys } from './Kbd.tsx';

describe('shortcutKeys', () => {
  it.each([
    ['Ctrl+Z', ['Ctrl', 'Z']],
    ['Ctrl+Shift+Z', ['Ctrl', 'Shift', 'Z']],
    ['+', ['+']],
    ['Ctrl++', ['Ctrl', '+']],
    ['-', ['-']],
    ['?', ['?']],
  ])('%s', (keys, expected) => {
    expect(shortcutKeys(keys)).toEqual(expected);
  });
});
