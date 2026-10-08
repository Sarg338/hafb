// A minimal ZIP reader for YNAB's export (ADR 0002 §8): stored and deflate entries, found through the
// central directory, CRC-checked. Inflate is the web-standard DecompressionStream('deflate-raw'),
// built into Node 22 and WebView2, so there's no zip dependency. Pure: bytes in, entries out.
import { ValidationError } from '@hafb/engine';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;

function bad(message: string): ValidationError {
  return new ValidationError(`Not a readable export zip: ${message}`);
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3, as ZIP uses). */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Writer API rather than pipeThrough: Node's and the DOM's stream typings disagree on pipeThrough.
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // A corrupt stream rejects here and in read() below; read() reports it.
  // A copy backed by a plain ArrayBuffer: the DOM typings refuse a possibly shared buffer.
  writer.write(new Uint8Array(data)).then(() => writer.close()).catch(() => undefined);
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Every file in the archive, by its full path inside the zip. Directories are skipped. Rejects
 * zip64, encrypted entries and compression methods other than stored and deflate.
 */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number): number => {
    if (at < 0 || at + 2 > bytes.length) throw bad('truncated');
    return view.getUint16(at, true);
  };
  const u32 = (at: number): number => {
    if (at < 0 || at + 4 > bytes.length) throw bad('truncated');
    return view.getUint32(at, true);
  };

  // End of central directory: the last EOCD signature whose comment length reaches the end.
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - EOCD_SIZE - MAX_COMMENT);
  for (let at = bytes.length - EOCD_SIZE; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE && at + EOCD_SIZE + view.getUint16(at + 20, true) === bytes.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw bad('no end-of-directory record (is this a zip file?)');
  const entryCount = u16(eocd + 10);
  const directorySize = u32(eocd + 12);
  const directoryOffset = u32(eocd + 16);
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIGNATURE)
  ) {
    throw bad('zip64 archives are not supported');
  }
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) throw bad('multi-part archives are not supported');

  const decoder = new TextDecoder('utf-8');
  const entries = new Map<string, Uint8Array>();
  let at = directoryOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (u32(at) !== CENTRAL_SIGNATURE) throw bad('damaged central directory');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const compressedSize = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const localOffset = u32(at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (flags & FLAG_ENCRYPTED) throw bad(`"${name}" is encrypted`);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) throw bad(`"${name}" uses compression method ${String(method)}`);
    if (u32(localOffset) !== LOCAL_SIGNATURE) throw bad(`damaged local header for "${name}"`);
    const dataStart = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    if (dataStart + compressedSize > bytes.length) throw bad(`"${name}" is truncated`);
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === METHOD_STORED) {
      data = raw.slice();
    } else {
      try {
        data = await inflateRaw(raw);
      } catch {
        throw bad(`"${name}" could not be decompressed`);
      }
    }
    if (data.length !== size) throw bad(`"${name}" has the wrong size`);
    if (crc32(data) !== crc) throw bad(`"${name}" failed its checksum`);
    entries.set(name, data);
  }
  return entries;
}
