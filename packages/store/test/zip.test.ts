import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, readZip } from '../src/import/zip.ts';

interface Entry {
  name: string;
  data: Uint8Array;
  method?: 0 | 8 | 12;
  flags?: number;
  crc?: number;
}

/** Build a zip by hand (PKWARE APPNOTE 4.3), so tests control every header field. */
function makeZip(entries: Entry[], comment = ''): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const name = enc.encode(e.name);
    const crc = e.crc ?? crc32(e.data);
    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, (e.flags ?? 0) | 0x800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, (e.flags ?? 0) | 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const commentBytes = enc.encode(comment);
  const dirSize = centrals.reduce((t, c) => t + c.length, 0);
  const eocd = new Uint8Array(22 + commentBytes.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, commentBytes.length, true);
  eocd.set(commentBytes, 22);
  const out = new Uint8Array(offset + dirSize + eocd.length);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const csv = 'a,b\n' + '1,2\n'.repeat(5000);

describe('readZip', () => {
  it('reads stored and deflated entries, skipping directories', async () => {
    const zip = makeZip([
      { name: 'dir/', data: new Uint8Array(), method: 0 },
      { name: 'dir/Plan as of 2026-10-08 - Plan.csv', data: text(csv) },
      { name: 'Register.csv', data: text('x,y\n'), method: 0 },
    ]);
    const entries = await readZip(zip);
    expect([...entries.keys()]).toEqual(['dir/Plan as of 2026-10-08 - Plan.csv', 'Register.csv']);
    expect(new TextDecoder().decode(entries.get('dir/Plan as of 2026-10-08 - Plan.csv'))).toBe(csv);
    expect(new TextDecoder().decode(entries.get('Register.csv'))).toBe('x,y\n');
  });

  it('handles UTF-8 names and an archive comment', async () => {
    const entries = await readZip(makeZip([{ name: 'Sarg’s Plan – 🛒.csv', data: text('ok') }], 'exported'));
    expect([...entries.keys()]).toEqual(['Sarg’s Plan – 🛒.csv']);
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });

  it.each<[string, () => Uint8Array, RegExp]>([
    ['not a zip', () => text('just some text, definitely not a zip archive'), /end-of-directory/],
    ['a bad checksum', () => makeZip([{ name: 'a.csv', data: text('hello'), crc: 1234 }]), /checksum/],
    ['encryption', () => makeZip([{ name: 'a.csv', data: text('hello'), flags: 1 }]), /encrypted/],
    ['another method', () => makeZip([{ name: 'a.csv', data: text('hello'), method: 12 }]), /method 12/],
    ['truncation', () => makeZip([{ name: 'a.csv', data: text(csv) }]).slice(30), /truncated|damaged|end-of-directory/],
  ])('rejects %s with a clear error', async (_, build, message) => {
    await expect(readZip(build())).rejects.toThrow(message);
  });

  it('rejects zip64', async () => {
    const zip = makeZip([{ name: 'a.csv', data: text('x') }]);
    const v = new DataView(zip.buffer);
    v.setUint32(zip.length - 22 + 16, 0xffffffff, true);
    await expect(readZip(zip)).rejects.toThrow(/zip64/);
  });

  const trialDir = join(import.meta.dirname, '../../engine/test/fixtures/local/ynab-trial');
  const trialZip = existsSync(trialDir) ? readdirSync(trialDir).find((f) => f.endsWith('.zip')) : undefined;
  it.skipIf(trialZip === undefined)('reads the real YNAB trial export (local only)', async () => {
    const entries = await readZip(new Uint8Array(readFileSync(join(trialDir, trialZip ?? ''))));
    const names = [...entries.keys()];
    expect(names.some((n) => n.endsWith('Plan.csv'))).toBe(true);
    expect(names.some((n) => n.endsWith('Register.csv'))).toBe(true);
    const exported = readdirSync(join(trialDir, 'export'));
    for (const [name, data] of entries) {
      const base = name.split('/').pop() ?? name;
      if (exported.includes(base)) expect(Buffer.from(data).equals(readFileSync(join(trialDir, 'export', base)))).toBe(true);
    }
  });
});
