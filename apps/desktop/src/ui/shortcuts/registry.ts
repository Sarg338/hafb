// Keyboard-shortcut registry core (S3.5). Pure: key strings and event-like objects in, the
// matching shortcut out. The React layer (ShortcutProvider) feeds it real KeyboardEvents.

/** Scopes, highest precedence first: a focused component beats the screen beats the app. */
export type ShortcutScope = 'component' | 'screen' | 'global';

const SCOPE_RANK: Record<ShortcutScope, number> = { component: 3, screen: 2, global: 1 };

export interface KeyCombo {
  /** Lower-case key name: a letter, digit, symbol, or a named key ('enter', 'escape', 'arrowdown', 'f10'). */
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface ShortcutDef {
  id: string;
  /** "Ctrl+Z", "Ctrl+Shift+Z", "?", "Shift+D", or a two-key sequence "G then P". */
  keys: string;
  description: string;
  /** Overlay grouping: "General", "Navigation", "Plan", "Register", … */
  group: string;
  scope: ShortcutScope;
  /** Default true. */
  enabled?: boolean;
  /** Fire even while the user is typing in a field. Default false (the field keeps the key). */
  allowInInputs?: boolean;
  /** Still runs when shortcuts are turned off or a modal dialog is open (overlay toggle, undo). */
  system?: boolean;
}

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface MatchContext {
  /** Focus is in a text field, textarea, select, contenteditable or combobox. */
  editable: boolean;
  /** A modal dialog is open. */
  modal: boolean;
  /** The user's "keyboard shortcuts on" setting. */
  enabled: boolean;
}

/** How long the second key of a sequence may follow the first. */
export const SEQUENCE_TIMEOUT_MS = 1000;

const ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  pgup: 'pageup',
  pgdn: 'pagedown',
  plus: '+',
  menu: 'contextmenu',
};

const DISPLAY: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  delete: 'Del',
  backspace: 'Backspace',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  contextmenu: 'Menu',
};

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os']);

function normalizeKeyName(name: string): string {
  const lower = name.toLowerCase();
  return ALIASES[lower] ?? lower;
}

function parseCombo(text: string): KeyCombo {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('Empty shortcut');
  // Split on '+' but keep a trailing '+' as the key itself ("Ctrl++", "+").
  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > 0) {
    const i = rest.indexOf('+');
    if (i < 0 || rest === '+') {
      parts.push(rest);
      break;
    }
    if (i === 0) {
      parts.push('+');
      rest = rest.slice(1);
      if (rest.startsWith('+')) rest = rest.slice(1);
      continue;
    }
    parts.push(rest.slice(0, i));
    rest = rest.slice(i + 1);
    if (rest === '') throw new Error(`Shortcut "${text}" ends with a modifier`);
  }
  const combo: KeyCombo = { key: '', ctrl: false, shift: false, alt: false };
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (p === 'ctrl' || p === 'control' || p === 'cmd' || p === 'meta') combo.ctrl = true;
    else if (p === 'shift') combo.shift = true;
    else if (p === 'alt' || p === 'option') combo.alt = true;
    else if (combo.key === '') combo.key = normalizeKeyName(raw.trim() === '' ? raw : raw.trim());
    else throw new Error(`Shortcut "${text}" names two keys; use "A then B" for a sequence`);
  }
  if (combo.key === '') throw new Error(`Shortcut "${text}" has no key`);
  return combo;
}

/** "Ctrl+Shift+Z" → one combo; "G then P" → two. */
export function parseKeys(text: string): KeyCombo[] {
  const steps = text.split(/\s+then\s+/i);
  if (steps.length > 2) throw new Error(`Shortcut "${text}": sequences are at most two keys`);
  return steps.map(parseCombo);
}

function formatCombo(c: KeyCombo): string {
  const name = DISPLAY[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1));
  return [c.ctrl ? 'Ctrl' : '', c.alt ? 'Alt' : '', c.shift ? 'Shift' : '', name].filter((s) => s !== '').join('+');
}

export function formatKeys(combos: readonly KeyCombo[]): string {
  return combos.map(formatCombo).join(' then ');
}

/** The combo an event represents, or null for a bare modifier press. */
export function eventCombo(e: KeyLike): KeyCombo | null {
  const raw = e.key;
  if (MODIFIER_KEYS.has(raw.toLowerCase())) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  let key = normalizeKeyName(raw);
  // With Ctrl/Alt held, layouts and AltGr can change the produced character: trust the physical
  // key for letters and digits so Ctrl+Z is Ctrl+Z on every layout.
  if ((ctrl || e.altKey) && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) key = e.code.slice(-1).toLowerCase();
  return { key, ctrl, shift: e.shiftKey, alt: e.altKey };
}

/** Letters and named keys compare Shift exactly; a symbol already implies its Shift ("?" is Shift+/). */
function sameCombo(want: KeyCombo, got: KeyCombo): boolean {
  if (want.key !== got.key || want.ctrl !== got.ctrl || want.alt !== got.alt) return false;
  const symbol = want.key.length === 1 && !/[a-z0-9]/.test(want.key);
  return symbol ? !want.shift || got.shift : want.shift === got.shift;
}

interface Pending {
  first: KeyCombo;
  at: number;
}

export interface Matcher {
  /** The shortcut to run for this key press, or null. Updates sequence state. */
  match: (defs: readonly ShortcutDef[], event: KeyLike, context: MatchContext, now: number) => ShortcutDef | null;
  /** A sequence's first key has been pressed and is waiting for the second. */
  pending: () => boolean;
  reset: () => void;
}

function allowed(d: ShortcutDef, context: MatchContext): boolean {
  if (d.enabled === false) return false;
  if ((!context.enabled || context.modal) && d.system !== true) return false;
  if (context.editable && d.allowInInputs !== true) return false;
  return true;
}

/** Highest scope wins; within a scope the most recently registered (last in the list) wins. */
function best(candidates: ShortcutDef[]): ShortcutDef | null {
  let winner: ShortcutDef | null = null;
  for (const d of candidates) if (!winner || SCOPE_RANK[d.scope] >= SCOPE_RANK[winner.scope]) winner = d;
  return winner;
}

export function createMatcher(): Matcher {
  let pending: Pending | null = null;
  return {
    pending: () => pending !== null,
    reset: () => {
      pending = null;
    },
    match(defs, event, context, now) {
      const got = eventCombo(event);
      if (!got) return null;
      const parsed = defs.filter((d) => allowed(d, context)).map((d) => ({ d, combos: parseKeys(d.keys) }));

      if (pending && now - pending.at <= SEQUENCE_TIMEOUT_MS) {
        const first = pending.first;
        pending = null;
        const second = parsed.filter(({ combos }) => {
          const [a, b] = combos;
          return a !== undefined && b !== undefined && sameCombo(a, first) && sameCombo(b, got);
        });
        const hit = best(second.map((x) => x.d));
        if (hit) return hit;
      } else {
        pending = null;
      }

      const single = parsed.filter(({ combos }) => combos.length === 1 && combos[0] !== undefined && sameCombo(combos[0], got));
      const hit = best(single.map((x) => x.d));
      if (hit) return hit;

      const starts = parsed.some(({ combos }) => combos.length === 2 && combos[0] !== undefined && sameCombo(combos[0], got));
      if (starts) pending = { first: got, at: now };
      return null;
    },
  };
}

export interface ShortcutConflict {
  /** Display form of the shared combo (or shared first key of a sequence). */
  keys: string;
  scope: ShortcutScope;
  ids: string[];
}

/** Enabled shortcuts in the same scope that would compete for the same key press. */
export function findConflicts(defs: readonly ShortcutDef[]): ShortcutConflict[] {
  const byKey = new Map<string, { keys: string; scope: ShortcutScope; ids: string[] }>();
  for (const d of defs) {
    if (d.enabled === false) continue;
    const combos = parseKeys(d.keys);
    const first = combos[0];
    if (!first) continue;
    // A single key and a sequence starting with it compete; so do two identical combos.
    const k = `${d.scope}|${formatCombo(first)}`;
    const entry = byKey.get(k) ?? { keys: formatCombo(first), scope: d.scope, ids: [] };
    entry.ids.push(d.id);
    byKey.set(k, entry);
  }
  const conflicts: ShortcutConflict[] = [];
  for (const entry of byKey.values()) {
    if (entry.ids.length < 2) continue;
    // Two different sequences sharing a first key ("G then P", "G then R") are fine.
    const group = defs.filter((d) => entry.ids.includes(d.id));
    const singles = group.filter((d) => parseKeys(d.keys).length === 1);
    const sequences = group.filter((d) => parseKeys(d.keys).length === 2);
    const sameSequence = new Set(sequences.map((d) => formatKeys(parseKeys(d.keys)))).size < sequences.length;
    if (singles.length >= 2 || (singles.length >= 1 && sequences.length >= 1) || sameSequence) conflicts.push(entry);
  }
  return conflicts;
}

/** Minimal element shape, so the check is testable without a DOM. */
export interface ElementLike {
  tagName: string;
  isContentEditable: boolean;
  getAttribute: (name: string) => string | null;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);
const TEXT_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);

/** True while focus is somewhere typing should go: shortcuts then leave the key alone. */
export function isEditableTarget(el: ElementLike | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.getAttribute('type') ?? 'text').toLowerCase());
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return TEXT_ROLES.has(el.getAttribute('role') ?? '');
}
