import { describe, expect, it } from 'vitest';
import {
  createMatcher,
  eventCombo,
  findConflicts,
  formatKeys,
  isEditableTarget,
  parseKeys,
  SEQUENCE_TIMEOUT_MS,
  type KeyLike,
  type ShortcutDef,
} from './registry.ts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: mods.code ?? '',
  ctrlKey: mods.ctrlKey ?? false,
  shiftKey: mods.shiftKey ?? false,
  altKey: mods.altKey ?? false,
  metaKey: mods.metaKey ?? false,
});

const def = (id: string, keys: string, extra: Partial<ShortcutDef> = {}): ShortcutDef => ({
  id,
  keys,
  description: id,
  group: 'General',
  scope: 'global',
  ...extra,
});

describe('parseKeys / formatKeys', () => {
  it('parses modifiers in any order and normalises names', () => {
    expect(parseKeys('Ctrl+Shift+Z')).toEqual([{ key: 'z', ctrl: true, shift: true, alt: false }]);
    expect(parseKeys('shift+ctrl+z')).toEqual([{ key: 'z', ctrl: true, shift: true, alt: false }]);
    expect(parseKeys('Esc')).toEqual([{ key: 'escape', ctrl: false, shift: false, alt: false }]);
    expect(parseKeys('Ctrl+Enter')).toEqual([{ key: 'enter', ctrl: true, shift: false, alt: false }]);
    expect(parseKeys('Shift+F10')).toEqual([{ key: 'f10', ctrl: false, shift: true, alt: false }]);
  });

  it('handles symbol keys, including plus', () => {
    expect(parseKeys('?')).toEqual([{ key: '?', ctrl: false, shift: false, alt: false }]);
    expect(parseKeys('+')).toEqual([{ key: '+', ctrl: false, shift: false, alt: false }]);
    expect(parseKeys('Ctrl++')).toEqual([{ key: '+', ctrl: true, shift: false, alt: false }]);
  });

  it('parses two-key sequences', () => {
    expect(parseKeys('G then P')).toEqual([
      { key: 'g', ctrl: false, shift: false, alt: false },
      { key: 'p', ctrl: false, shift: false, alt: false },
    ]);
  });

  it('rejects malformed combos', () => {
    expect(() => parseKeys('')).toThrow();
    expect(() => parseKeys('Ctrl+')).toThrow();
    expect(() => parseKeys('A then B then C')).toThrow(/two keys/);
  });

  it('formats for display', () => {
    expect(formatKeys(parseKeys('shift+ctrl+z'))).toBe('Ctrl+Shift+Z');
    expect(formatKeys(parseKeys('g then p'))).toBe('G then P');
    expect(formatKeys(parseKeys('escape'))).toBe('Esc');
    expect(formatKeys(parseKeys('arrowdown'))).toBe('↓');
  });
});

describe('eventCombo', () => {
  it('ignores bare modifier presses', () => {
    expect(eventCombo(key('Shift', { shiftKey: true }))).toBeNull();
    expect(eventCombo(key('Control', { ctrlKey: true }))).toBeNull();
  });

  it('treats Meta as Ctrl', () => {
    expect(eventCombo(key('z', { metaKey: true }))).toEqual({ key: 'z', ctrl: true, shift: false, alt: false });
  });

  it('uses the physical letter when Ctrl/Alt change the produced character', () => {
    // A non-US layout or AltGr can make Ctrl+Z report another key value.
    expect(eventCombo(key('\u001a', { ctrlKey: true, code: 'KeyZ' }))).toEqual({ key: 'z', ctrl: true, shift: false, alt: false });
    expect(eventCombo(key('ω', { altKey: true, code: 'KeyW' }))?.key).toBe('w');
  });

  it('lower-cases shifted letters', () => {
    expect(eventCombo(key('D', { shiftKey: true, code: 'KeyD' }))).toEqual({ key: 'd', ctrl: false, shift: true, alt: false });
  });
});

describe('matcher', () => {
  const base = { editable: false, modal: false, enabled: true };

  it('matches single combos; a shifted symbol does not need "Shift" in the definition', () => {
    const m = createMatcher();
    const defs = [def('help', '?'), def('undo', 'Ctrl+Z'), def('dup', 'Shift+D')];
    expect(m.match(defs, key('?', { shiftKey: true }), base, 0)?.id).toBe('help');
    expect(m.match(defs, key('z', { ctrlKey: true }), base, 0)?.id).toBe('undo');
    expect(m.match(defs, key('D', { shiftKey: true }), base, 0)?.id).toBe('dup');
    expect(m.match(defs, key('d'), base, 0)).toBeNull();
    expect(m.match(defs, key('z', { ctrlKey: true, shiftKey: true }), base, 0)).toBeNull();
  });

  it('component beats screen beats global', () => {
    const m = createMatcher();
    const defs = [def('g', 'Enter'), def('s', 'Enter', { scope: 'screen' }), def('c', 'Enter', { scope: 'component' })];
    expect(m.match(defs, key('Enter'), base, 0)?.id).toBe('c');
    expect(m.match(defs.slice(0, 2), key('Enter'), base, 0)?.id).toBe('s');
  });

  it('within a scope the most recently registered wins', () => {
    const m = createMatcher();
    expect(m.match([def('first', 'Ctrl+K'), def('second', 'Ctrl+K')], key('k', { ctrlKey: true }), base, 0)?.id).toBe('second');
  });

  it('skips disabled definitions', () => {
    const m = createMatcher();
    expect(m.match([def('off', 'Ctrl+K', { enabled: false })], key('k', { ctrlKey: true }), base, 0)).toBeNull();
  });

  it('does not fire while typing unless allowed', () => {
    const m = createMatcher();
    const editing = { ...base, editable: true };
    expect(m.match([def('undo', 'Ctrl+Z')], key('z', { ctrlKey: true }), editing, 0)).toBeNull();
    expect(m.match([def('save', 'Ctrl+Enter', { allowInInputs: true })], key('Enter', { ctrlKey: true }), editing, 0)?.id).toBe('save');
  });

  it('when shortcuts are turned off only system shortcuts run', () => {
    const m = createMatcher();
    const off = { ...base, enabled: false };
    const defs = [def('dup', 'Shift+D'), def('help', '?', { system: true })];
    expect(m.match(defs, key('D', { shiftKey: true }), off, 0)).toBeNull();
    expect(m.match(defs, key('?', { shiftKey: true }), off, 0)?.id).toBe('help');
  });

  it('while a modal is open only system shortcuts run', () => {
    const m = createMatcher();
    const modal = { ...base, modal: true };
    expect(m.match([def('dup', 'Shift+D')], key('D', { shiftKey: true }), modal, 0)).toBeNull();
    expect(m.match([def('undo', 'Ctrl+Z', { system: true })], key('z', { ctrlKey: true }), modal, 0)?.id).toBe('undo');
  });

  it('runs two-key sequences within the timeout', () => {
    const m = createMatcher();
    const defs = [def('goPlan', 'G then P'), def('gOnly', 'X')];
    expect(m.match(defs, key('g'), base, 1000)).toBeNull();
    expect(m.pending()).toBe(true);
    expect(m.match(defs, key('p'), base, 1500)?.id).toBe('goPlan');
    expect(m.pending()).toBe(false);
  });

  it('a sequence expires after the timeout', () => {
    const m = createMatcher();
    const defs = [def('goPlan', 'G then P')];
    m.match(defs, key('g'), base, 0);
    expect(m.match(defs, key('p'), base, SEQUENCE_TIMEOUT_MS + 1)).toBeNull();
  });

  it('a wrong second key cancels the sequence', () => {
    const m = createMatcher();
    const defs = [def('goPlan', 'G then P'), def('x', 'X')];
    m.match(defs, key('g'), base, 0);
    expect(m.match(defs, key('x'), base, 10)?.id).toBe('x');
    expect(m.pending()).toBe(false);
  });

  it('modifier presses during a sequence do not cancel it', () => {
    const m = createMatcher();
    const defs = [def('goReflect', 'G then Shift+R')];
    m.match(defs, key('g'), base, 0);
    m.match(defs, key('Shift', { shiftKey: true }), base, 5);
    expect(m.match(defs, key('R', { shiftKey: true }), base, 10)?.id).toBe('goReflect');
  });
});

describe('findConflicts', () => {
  it('reports enabled shortcuts sharing keys in the same scope', () => {
    const conflicts = findConflicts([
      def('a', 'Ctrl+K'),
      def('b', 'ctrl+k'),
      def('c', 'Ctrl+K', { scope: 'screen' }),
      def('d', 'Ctrl+K', { enabled: false }),
    ]);
    expect(conflicts).toEqual([{ keys: 'Ctrl+K', scope: 'global', ids: ['a', 'b'] }]);
  });

  it('a sequence prefix that is also a single shortcut conflicts', () => {
    expect(findConflicts([def('a', 'G'), def('b', 'G then P')])).toEqual([{ keys: 'G', scope: 'global', ids: ['a', 'b'] }]);
  });
});

describe('isEditableTarget', () => {
  const el = (tagName: string, attrs: Record<string, string> = {}, isContentEditable = false) => ({
    tagName,
    isContentEditable,
    getAttribute: (n: string) => attrs[n] ?? null,
  });

  it.each([
    [el('INPUT', { type: 'text' }), true],
    [el('INPUT', { type: 'checkbox' }), false],
    [el('INPUT', { type: 'radio' }), false],
    [el('INPUT', { type: 'button' }), false],
    [el('TEXTAREA'), true],
    [el('SELECT'), true],
    [el('DIV', {}, true), true],
    [el('DIV', { role: 'combobox' }), true],
    [el('DIV', { role: 'textbox' }), true],
    [el('BUTTON'), false],
    [el('DIV'), false],
  ])('%#', (target, expected) => {
    expect(isEditableTarget(target)).toBe(expected);
  });

  it('null is not editable', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
