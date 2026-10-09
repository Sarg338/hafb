import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeZip } from '../src/export/zipWrite.ts';
import { readZip } from '../src/import/zip.ts';

const enc = new TextEncoder();

describe('writeZip', () => {
  it('round-trips through the reader, names and bytes intact (UTF-8 names)', async () => {
    const files = [
      { name: 'report.csv', bytes: enc.encode('\uFEFF"a","b"\r\n1,2\r\n') },
      { name: 'Café – transactions.csv', bytes: enc.encode('x') },
      { name: 'empty.txt', bytes: new Uint8Array(0) },
    ];
    const read = await readZip(writeZip(files));
    expect([...read.keys()]).toEqual(files.map((f) => f.name));
    for (const f of files) expect(read.get(f.name)).toEqual(f.bytes);
  });

  it('is a zip that Windows itself can open', () => {
    if (process.platform !== 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'zipw-'));
    try {
      writeFileSync(join(dir, 'out.zip'), writeZip([{ name: 'a.csv', bytes: enc.encode('hello') }], '2026-10-09T06:20'));
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${join(dir, 'out.zip')}' -DestinationPath '${join(dir, 'x')}'`]);
      expect(readFileSync(join(dir, 'x', 'a.csv'), 'utf8')).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
