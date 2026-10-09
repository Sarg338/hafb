import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, decodeBankFile, fileKind, initialMapping, loadFile, mappingFromProfile, profileOf, rowsFor } from './importModel.ts';

const CSV = 'Date,Description,Amount\n10/01/2026,COFFEE,-4.50\n10/02/2026,PAYROLL,1000.00\n';
const OFX = 'OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20261005<TRNAMT>-2.00<FITID>A<NAME>SHOP<MEMO>note</STMTTRN></BANKTRANLIST></OFX>';
const QIF = '!Type:Bank\nD10/03/2026\nT-9.00\nPGAS\nMfill up\n^\n';

describe('Import Transactions (S6.5)', () => {
  it('tells the file kinds apart by extension or content', () => {
    expect(fileKind('a.csv', CSV)).toBe('csv');
    expect(fileKind('statement.qfx', 'whatever')).toBe('ofx');
    expect(fileKind('download.txt', OFX)).toBe('ofx');
    expect(fileKind('x.QIF', QIF)).toBe('qif');
  });

  it('reads every kind; a broken file keeps its name and why', () => {
    expect(loadFile('a.csv', CSV, 2).csv?.rows).toHaveLength(3);
    expect(loadFile('b.ofx', OFX, 2).rows).toHaveLength(1);
    expect(loadFile('c.qif', QIF, 2).rows).toHaveLength(1);
    expect(loadFile('d.ofx', '<OFX></OFX>', 2).error).toMatch(/No transactions/);
  });

  it('applies the options: memos, payee/memo swap and amount swap for OFX/QIF; the mapping for CSV', () => {
    const files = [loadFile('a.csv', CSV, 2), loadFile('b.ofx', OFX, 2), loadFile('c.qif', QIF, 2)];
    const csv = initialMapping(files, undefined);
    const { rows } = rowsFor(files, { ...DEFAULT_OPTIONS, csv }, 2);
    expect(rows.map((r) => [r.payee, r.memo, r.amount])).toEqual([
      ['COFFEE', '', -450],
      ['PAYROLL', '', 100_000],
      ['SHOP', 'note', -200],
      ['GAS', 'fill up', -900],
    ]);
    const swapped = rowsFor(files.slice(1), { ...DEFAULT_OPTIONS, csv: null, importMemos: false, swapPayeeMemo: true, swapAmounts: true }, 2).rows;
    expect(swapped.map((r) => [r.payee, r.memo, r.amount])).toEqual([
      ['note', '', 200],
      ['fill up', '', 900],
    ]);
  });

  it('remembers the CSV mapping per account and uses it when it still fits', () => {
    const files = [loadFile('a.csv', CSV, 2)];
    const guessed = initialMapping(files, undefined);
    if (!guessed) throw new Error('no mapping');
    const saved = profileOf({ ...guessed, columns: ['date', 'memo', 'amount'], swap: true });
    const csv = files[0]?.csv;
    if (!csv) throw new Error('no csv');
    expect(mappingFromProfile(saved, csv)).toMatchObject({ columns: ['date', 'memo', 'amount'], swap: true });
    expect(initialMapping(files, saved)?.columns).toEqual(['date', 'memo', 'amount']);
    // A profile for a different layout is ignored.
    expect(mappingFromProfile({ ...guessed, columns: ['date', 'payee'] }, csv)).toBeNull();
    expect(mappingFromProfile('nonsense', csv)).toBeNull();
  });

  it('decodes UTF-8, and Windows-1252 from older bank exports', () => {
    expect(decodeBankFile(new TextEncoder().encode('Café'))).toBe('Café');
    expect(decodeBankFile(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });

  it('decodes UTF-16 files by their byte-order mark (a public sample export is UTF-16LE)', () => {
    expect(decodeBankFile(new Uint8Array([0xff, 0xfe, 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9, 0x00]))).toBe('Café');
    expect(decodeBankFile(new Uint8Array([0xfe, 0xff, 0x00, 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9]))).toBe('Café');
  });
});
