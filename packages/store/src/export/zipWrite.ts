// A minimal ZIP writer (stored entries, no compression) for exports that are more than one file:
// Reflect's Spending reports (a summary plus its transactions, as YNAB exports them) and the
// YNAB-format plan export (Plan.csv + Register.csv). Readable by Windows Explorer, Excel and YNAB.
import { crc32 } from '../import/zip.ts';

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const utf8 = new TextEncoder();

/** DOS date/time fields from a local "YYYY-MM-DDTHH:MM[:SS]" stamp (zip has no time zone). */
export function dosStamp(local: string): { time: number; date: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(local);
  const n = (i: number) => Number(m?.[i] ?? '0');
  const year = Math.max(1980, m ? n(1) : 1980);
  return {
    time: (n(4) << 11) | (n(5) << 5) | Math.floor(n(6) / 2),
    date: ((year - 1980) << 9) | (Math.max(1, n(2)) << 5) | Math.max(1, n(3)),
  };
}

/** Pack files into one stored (uncompressed) zip. Names are written as UTF-8 (flag bit 11). */
export function writeZip(entries: readonly ZipEntry[], localStamp = '1980-01-01T00:00'): Uint8Array {
  const { time, date } = dosStamp(localStamp);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at2 = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at2);
    at2 += part.length;
  }
  return out;
}
