// The Import Transactions dialog (S6.5), pure. YNAB's options (file import guide, 2026):
// CSV: the column mapping (Date, Payee, Memo, Outflow, Inflow; one Amount column for both), "No
// header row", "Swap Inflow and Outflow", "Remember setting for this account"; QFX/OFX/QIF:
// "Import Memos", "Swap Payee and Memo", "Swap Inflow and Outflow"; all files: include
// transactions dated before the account's start. Several OFX/QFX files can import at once.
import { guessCsvMapping, inspectCsv, parseCsvRows, parseOfx, parseQif, type BankRow, type CsvColumn, type CsvFile, type CsvMapping, type DateOrder } from '@hafb/engine';
import { neg } from '@hafb/shared';
import type { JsonValue } from '@hafb/store';

export type FileKind = 'csv' | 'ofx' | 'qif';

export interface LoadedFile {
  name: string;
  kind: FileKind;
  /** CSV: the split rows (mapping comes later). */
  csv?: CsvFile;
  /** OFX/QFX/QIF: the rows as the bank wrote them. */
  rows?: BankRow[];
  /** OFX: the statement's account number (last digits shown in the preview). */
  bankAccount?: string;
  error?: string;
}

export function fileKind(name: string, text: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'ofx' || ext === 'qfx' || /OFXHEADER|<OFX>/i.test(text.slice(0, 2000))) return 'ofx';
  if (ext === 'qif' || /^\s*!Type:/im.test(text.slice(0, 500))) return 'qif';
  return 'csv';
}

/** Read one file. A file that can't be read keeps its name and the reason. */
export function loadFile(name: string, text: string, decimals: number, qifOrder: DateOrder = 'MDY'): LoadedFile {
  const kind = fileKind(name, text);
  try {
    if (kind === 'ofx') {
      const r = parseOfx(text, decimals);
      return { name, kind, rows: r.rows, ...(r.accountId === undefined ? {} : { bankAccount: r.accountId }) };
    }
    if (kind === 'qif') return { name, kind, rows: parseQif(text, qifOrder, decimals) };
    const csv = inspectCsv(text);
    if (csv.rows.length === 0) throw new Error('No transactions in this file');
    return { name, kind, csv };
  } catch (e) {
    return { name, kind, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ImportOptions {
  /** The CSV mapping (shared by every CSV file in this import). */
  csv: CsvMapping | null;
  importMemos: boolean;
  swapPayeeMemo: boolean;
  /** OFX/QIF; CSV swaps through its mapping. */
  swapAmounts: boolean;
  includeBeforeStart: boolean;
  rememberCsv: boolean;
}

export const DEFAULT_OPTIONS: ImportOptions = { csv: null, importMemos: true, swapPayeeMemo: false, swapAmounts: false, includeBeforeStart: false, rememberCsv: true };

export interface FileError {
  file: string;
  line: number;
  message: string;
}

/** Every row to import, in file order, with the options applied. */
export function rowsFor(files: readonly LoadedFile[], options: ImportOptions, decimals: number): { rows: BankRow[]; errors: FileError[] } {
  const rows: BankRow[] = [];
  const errors: FileError[] = [];
  for (const f of files) {
    if (f.error !== undefined) continue;
    if (f.csv) {
      if (!options.csv) continue;
      const parsed = parseCsvRows(f.csv, options.csv, decimals);
      rows.push(...parsed.rows);
      errors.push(...parsed.errors.map((e) => ({ file: f.name, ...e })));
      continue;
    }
    for (const r of f.rows ?? []) {
      const payee = options.swapPayeeMemo ? r.memo : r.payee;
      const memo = options.swapPayeeMemo ? r.payee : r.memo;
      rows.push({ ...r, payee, memo: options.importMemos ? memo : '', amount: options.swapAmounts ? neg(r.amount) : r.amount });
    }
  }
  return { rows, errors };
}

export const COLUMN_OPTIONS: readonly { id: CsvColumn; label: string }[] = [
  { id: 'date', label: 'Date' },
  { id: 'payee', label: 'Payee' },
  { id: 'memo', label: 'Memo' },
  { id: 'outflow', label: 'Outflow' },
  { id: 'inflow', label: 'Inflow' },
  { id: 'amount', label: 'Amount (Inflow and Outflow)' },
  { id: 'skip', label: 'Don’t import' },
];

export const DATE_ORDERS: readonly { id: DateOrder; label: string }[] = [
  { id: 'MDY', label: 'Month / Day / Year' },
  { id: 'DMY', label: 'Day / Month / Year' },
  { id: 'YMD', label: 'Year / Month / Day' },
];

const COLUMNS: readonly CsvColumn[] = ['date', 'payee', 'memo', 'outflow', 'inflow', 'amount', 'skip'];

/** The remembered mapping, as stored in the plan (import_profiles). */
export function profileOf(m: CsvMapping): JsonValue {
  return { columns: [...m.columns], header: m.header, dateOrder: m.dateOrder, decimalSeparator: m.decimalSeparator, swap: m.swap };
}

const isRecord = (v: JsonValue): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A remembered mapping, if it still fits this file (same number of columns). */
export function mappingFromProfile(profile: JsonValue | undefined, csv: CsvFile): CsvMapping | null {
  if (profile === undefined || !isRecord(profile)) return null;
  const p = profile;
  const cols = p.columns;
  const width = Math.max(0, ...csv.rows.map((r) => r.length));
  if (!Array.isArray(cols) || cols.length !== width) return null;
  const columns: CsvColumn[] = [];
  for (const c of cols) {
    const found = COLUMNS.find((x) => x === c);
    if (!found) return null;
    columns.push(found);
  }
  const order = DATE_ORDERS.find((o) => o.id === p.dateOrder)?.id;
  if (order === undefined) return null;
  return { columns, header: p.header === true, dateOrder: order, decimalSeparator: p.decimalSeparator === ',' ? ',' : '.', swap: p.swap === true };
}

/** The first guess for a CSV import: the remembered mapping when it fits, else the detected one. */
export function initialMapping(files: readonly LoadedFile[], profile: JsonValue | undefined): CsvMapping | null {
  const csv = files.find((f) => f.csv)?.csv;
  if (!csv) return null;
  return mappingFromProfile(profile, csv) ?? guessCsvMapping(csv);
}

/** Decode a bank file: UTF-8 when it is valid, else Windows-1252 (older bank exports). */
export function decodeBankFile(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
