// Components read design values only from theme tokens (ADR 0003 amendment, ADR 0004). This scan
// fails on hard-coded colours, font families, radii and rule styles, so any future skin reaches
// every component. src/ui (the component library) is strict: sizes and durations must be tokens
// too. A line ending in a `scan-ok:` comment documents a deliberate exception.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(path, ext));
    else if (ext.test(entry.name)) out.push(path);
  }
  return out;
}

interface Rule {
  name: string;
  test: RegExp;
}

const COMMON: Rule[] = [
  { name: 'raw colour', test: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/ },
  { name: 'literal font family', test: /font-family:(?!\s*(var\(|inherit))/ },
  { name: 'literal font family in shorthand', test: /\bfont:\s*[^;]*['"]/ },
  { name: 'literal radius', test: /border-radius:(?!\s*(var\(|0;|50%|inherit))/ },
  { name: 'literal rule style', test: /\b(dashed|dotted|double)\b/ },
];

const STRICT: Rule[] = [
  ...COMMON,
  { name: 'literal font size', test: /font-size:\s*\d/ },
  { name: 'literal size in font shorthand', test: /\bfont:\s*(?![^;]*var\(--t-size)[^;]*\d+(\.\d+)?px/ },
  { name: 'literal duration', test: /\b\d+(\.\d+)?m?s\b(?![^;]*var\()/ },
];

function violations(file: string, rules: Rule[]): string[] {
  const out: string[] = [];
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (line.includes('scan-ok:')) return;
      const code = line.replace(/\/\*.*?\*\//g, '');
      for (const rule of rules) if (rule.test.test(code)) out.push(`${relative(SRC, file)}:${String(i + 1)} ${rule.name}: ${line.trim()}`);
    });
  return out;
}

describe('design values come from theme tokens', () => {
  it('component library CSS (src/ui) uses tokens for colour, type, shape, size and motion', () => {
    const found = files(join(SRC, 'ui'), /\.css$/).flatMap((f) => violations(f, STRICT));
    expect(found).toEqual([]);
  });

  it('component library TSX (src/ui) has no inline raw colours or fonts', () => {
    const found = files(join(SRC, 'ui'), /\.tsx?$/)
      .filter((f) => !f.endsWith('.test.ts'))
      .flatMap((f) => violations(f, COMMON.slice(0, 3)));
    expect(found).toEqual([]);
  });

  it('S3.1 mockup CSS (src/design) uses tokens for colour, fonts, radii and rules', () => {
    const found = files(join(SRC, 'design'), /\.css$/).flatMap((f) => violations(f, COMMON));
    expect(found).toEqual([]);
  });
});
