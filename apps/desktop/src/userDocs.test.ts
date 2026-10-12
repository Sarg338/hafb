// The user guides (S8.5) quote the app's labels in bold: every bold label must still exist in the
// app's source, so a renamed button can't leave the guide pointing at something that isn't there.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const GUIDES = ['docs/user-guide.md', 'docs/migrating-from-ynab.md'];
/** YNAB's own labels, quoted in the migration guide. */
const YNAB_LABELS = new Set(['Export Plan']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [readFileSync(path, 'utf8')] : [];
  });
}

describe('the user guides quote real labels', () => {
  const app = sources(import.meta.dirname).join('\n');
  for (const guide of GUIDES) {
    it(guide, () => {
      const text = readFileSync(join(ROOT, guide), 'utf8');
      // Bold run-in headings end with a colon or full stop, and quoted messages start with a quote: neither is a label.
      const labels = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1] ?? '').filter((l) => !YNAB_LABELS.has(l) && !/[:.]$|^"/.test(l));
      expect(labels.length).toBeGreaterThan(10);
      const missing = [...new Set(labels)].filter((l) => !app.includes(l));
      expect(missing).toEqual([]);
    });
  }
});
