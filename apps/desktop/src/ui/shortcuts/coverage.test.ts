// S7.3 "every entry tested": each listed shortcut is registered with the same keys somewhere in the
// app, or handled inside a component whose test file exists; and docs/shortcuts.md is current.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shortcutsMarkdown } from './shortcutDoc.ts';
import { YNAB_SHORTCUTS } from './ynabShortcuts.ts';

const SRC = join(import.meta.dirname, '../..');
const REPO = join(SRC, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(n) && !n.includes('.test.') ? [p] : [];
  });
}

/** id → keys of every useShortcut({ id, keys }) call in the app. */
function registered(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/useShortcut\(\{\s*id:\s*(?:'([^']+)'|(OVERLAY_SHORTCUT_ID)),\s*keys:\s*'([^']+)'/g)) {
      out.set(m[1] ?? 'general.shortcuts', m[3] ?? '');
    }
  }
  return out;
}

describe('keyboard completeness (S7.3)', () => {
  const reg = registered();

  it.each(YNAB_SHORTCUTS.filter((s) => s.inComponent !== true).map((s) => [s.id, s.keys] as const))('%s (%s) is registered with those keys', (id, keys) => {
    expect(reg.get(id)).toBe(keys);
  });

  it.each(YNAB_SHORTCUTS.filter((s) => s.inComponent === true).map((s) => [s.id, s.coveredBy ?? ''] as const))('%s is covered by %s', (_id, file) => {
    expect(file).not.toBe('');
    expect(existsSync(join(REPO, file))).toBe(true);
  });

  it('lists no id twice', () => {
    const ids = YNAB_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('docs/shortcuts.md is the list', () => {
    const path = join(REPO, 'docs/shortcuts.md');
    const text = shortcutsMarkdown();
    if (process.env.HAFB_WRITE_DOCS === '1') writeFileSync(path, text);
    expect(existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '', `run with HAFB_WRITE_DOCS=1 to write ${relative(REPO, path)}`).toBe(text);
  });
});
