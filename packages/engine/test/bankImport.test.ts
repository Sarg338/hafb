// Bank file import (S6.5): CSV mapping, OFX/QFX, QIF, payee cleanup and the import decisions.
// Fixtures are synthetic, shaped like common bank exports (no real data).
import { describe, expect, it } from 'vitest';
import { minor } from '@hafb/shared';
import { cleansePayee, guessCsvMapping, inspectCsv, parseCsvRows, parseOfx, parseQif, planImport, syntheticImportIds, type BankRow, type ExistingTransaction } from '../src/bankImport/index.ts';

const row = (date: string, amount: number, payee = 'X', extra: Partial<BankRow> = {}): BankRow => ({ date: date as BankRow['date'], amount: minor(amount), payee, memo: '', ...extra });

describe('CSV inspection and mapping (YNAB: Date, Payee, Memo, Outflow, Inflow; one Amount column for both)', () => {
  it('detects the delimiter, the header and a debit/credit layout', () => {
    const text = 'Date,Description,Debit,Credit,Balance\r\n10/01/2026,"COFFEE SHOP #12, NASHVILLE",4.50,,995.50\r\n10/02/2026,PAYROLL DEPOSIT,,"1,250.00",2245.50\r\n';
    const csv = inspectCsv(text);
    expect(csv.delimiter).toBe(',');
    expect(csv.rows).toHaveLength(3);
    const m = guessCsvMapping(csv);
    expect(m).toMatchObject({ header: true, dateOrder: 'MDY', decimalSeparator: '.', columns: ['date', 'payee', 'outflow', 'inflow', 'skip'] });
    const parsed = parseCsvRows(csv, m, 2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([row('2026-10-01', -450, 'COFFEE SHOP #12, NASHVILLE'), row('2026-10-02', 125_000, 'PAYROLL DEPOSIT')]);
  });

  it('a single signed Amount column, semicolons, a decimal comma and day-first dates', () => {
    const text = 'Datum;Omschrijving;Bedrag;Notitie\n31-10-2026;Supermarkt;-12,50;weekly\n01-11-2026;Salaris;2.500,00;\n';
    const csv = inspectCsv(text);
    expect(csv.delimiter).toBe(';');
    const m = guessCsvMapping(csv);
    expect(m.columns).toEqual(['date', 'payee', 'amount', 'memo']);
    expect(m).toMatchObject({ dateOrder: 'DMY', decimalSeparator: ',' });
    expect(parseCsvRows(csv, m, 2).rows).toEqual([row('2026-10-31', -1250, 'Supermarkt', { memo: 'weekly' }), row('2026-11-01', 250_000, 'Salaris')]);
  });

  it('no header row, swap inflow/outflow, ISO dates and parenthesised negatives', () => {
    const csv = inspectCsv('2026-10-03\tGas Station\t(40.00)\n2026-10-04\tRefund\t5.00\n');
    expect(csv.delimiter).toBe('\t');
    const m = { ...guessCsvMapping(csv), header: false, columns: ['date', 'payee', 'amount'] as const, swap: true };
    const parsed = parseCsvRows(csv, m, 2);
    expect(parsed.rows.map((r) => r.amount)).toEqual([4000, -500]); // swapped
    expect(parsed.rows[0]?.date).toBe('2026-10-03');
  });

  it('keeps zero-amount rows and reports rows it cannot read', () => {
    const csv = inspectCsv('Date,Payee,Amount\n10/01/2026,Pending hold,0.00\nnot a date,Bad,1.00\n10/02/2026,No amount,\n');
    const parsed = parseCsvRows(csv, guessCsvMapping(csv), 2);
    expect(parsed.rows.map((r) => [r.payee, r.amount])).toEqual([['Pending hold', 0]]);
    expect(parsed.errors.map((e) => e.line)).toEqual([3, 4]);
  });
});

describe('OFX / QFX', () => {
  it('reads SGML OFX 1.x (unclosed tags), with FITIDs and negative outflows', () => {
    const sgml = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>123<ACCTID>9999<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000[-5:CDT]<TRNAMT>-23.45<FITID>2026100501<NAME>GROCERY MART 0423<MEMO>POS PURCHASE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>1000.00<FITID>2026100602<NAME>ACME PAYROLL</STMTTRN>
<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20261007<TRNAMT>-150<FITID>2026100703<CHECKNUM>1042<NAME>CHECK 1042</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = parseOfx(sgml, 2);
    expect(r.accountId).toBe('9999');
    expect(r.rows).toEqual([
      row('2026-10-05', -2345, 'GROCERY MART 0423', { memo: 'POS PURCHASE', importId: '2026100501' }),
      row('2026-10-06', 100_000, 'ACME PAYROLL', { importId: '2026100602' }),
      row('2026-10-07', -15_000, 'CHECK 1042', { importId: '2026100703', checkNumber: '1042' }),
    ]);
  });

  it('reads XML OFX 2.x and the card (CCSTMTRS) layout, decoding entities', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>4111</ACCTID></CCACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261009</DTPOSTED><TRNAMT>-8.99</TRNAMT><FITID>A1</FITID><NAME>B&amp;B Diner</NAME></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261010</DTPOSTED><TRNAMT>200.00</TRNAMT><FITID>A2</FITID><NAME>PAYMENT THANK YOU</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const r = parseOfx(xml, 2);
    expect(r.accountId).toBe('4111');
    expect(r.rows.map((x) => [x.date, x.amount, x.payee, x.importId])).toEqual([
      ['2026-10-09', -899, 'B&B Diner', 'A1'],
      ['2026-10-10', 20_000, 'PAYMENT THANK YOU', 'A2'],
    ]);
  });

  it('a file with no transactions is an error, not an empty import', () => {
    expect(() => parseOfx('<OFX></OFX>', 2)).toThrow(/No transactions/);
  });
});

describe('QIF', () => {
  it('reads a bank QIF with short years and splits-free records', () => {
    const qif = `!Type:Bank
D10/ 1'26
T-4.50
PCOFFEE SHOP
MLatte
^
D10/02/2026
T1,250.00
PPAYROLL
N1001
^
`;
    expect(parseQif(qif, 'MDY', 2)).toEqual([row('2026-10-01', -450, 'COFFEE SHOP', { memo: 'Latte' }), row('2026-10-02', 125_000, 'PAYROLL', { checkNumber: '1001' })]);
  });
});

describe('payee cleanup (YNAB cleans imported names)', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFEE', 'Blue Bottle Coffee'],
    ['TST* TACO STAND 0042', 'Taco Stand'],
    ['POS PURCHASE GROCERY MART #0423 NASHVILLE TN', 'Grocery Mart'],
    ['AMZN Mktp US*2K4LL1X40', 'Amzn Mktp US'],
    ['PAYPAL *SPOTIFY', 'Spotify'],
    ['DEBIT CARD PURCHASE - SHELL OIL 57442 10/05', 'Shell Oil'],
    ['Acme Payroll', 'Acme Payroll'],
    ['CHECK 1042', 'Check 1042'],
    ['PAYMENT TO VISA CARD', 'Payment To Visa Card'],
    ['CVS PHARMACY 01234 AT US', 'CVS Pharmacy 01234 At US'],
    ['', ''],
  ])('%s → %s', (raw, clean) => {
    expect(cleansePayee(raw)).toBe(clean);
  });
});

describe('synthetic import ids (no FITID)', () => {
  it('number repeats of the same amount on the same day', () => {
    const ids = syntheticImportIds([row('2026-10-01', -500), row('2026-10-01', -500), row('2026-10-02', -500), row('2026-10-01', -500, 'Y', { importId: 'F1' })]);
    expect(ids).toEqual(['file:-500:2026-10-01:1', 'file:-500:2026-10-01:2', 'file:-500:2026-10-02:1', 'F1']);
  });
});

describe('import decisions (§5.12, D4, D13)', () => {
  const base = { reconciledThrough: null, startDate: null, includeBeforeStart: true, scheduled: [], rejected: new Set<string>() };
  const tx = (id: string, date: string, amount: number, extra: Partial<ExistingTransaction> = {}): ExistingTransaction => ({ id, date: date as ExistingTransaction['date'], amount: minor(amount), ...extra });

  it('skips ids already imported (deleted too) and rejected imports; across formats, the same date and amount is a duplicate', () => {
    const rows = [row('2026-10-01', -500, 'A', { importId: 'F1' }), row('2026-10-02', -700, 'B', { importId: 'F2' }), row('2026-10-03', -900, 'C', { importId: 'F3' }), row('2026-10-04', -1100, 'D', { importId: 'other-id' }), row('2026-10-05', -1300, 'E', { importId: 'F5' })];
    const existing = [tx('t1', '2026-10-01', -500, { importId: 'F1' }), tx('t2', '2026-10-02', -700, { importId: 'F2', deleted: true }), tx('t4', '2026-10-04', -1100, { importId: 'file:-1100:2026-10-04:1' })];
    const d = planImport({ ...base, rows, existing, rejected: new Set(['F3']) });
    expect(d.map((x) => (x.kind === 'skip' ? x.reason : x.kind))).toEqual(['duplicate', 'deleted', 'rejected', 'duplicate', 'new']);
  });

  it('two identical charges on one day both import when only one exists already', () => {
    const rows = [row('2026-10-01', -500, 'A'), row('2026-10-01', -500, 'A')];
    const existing = [tx('t1', '2026-10-01', -500, { importId: 'old-format' })];
    expect(planImport({ ...base, rows, existing }).map((x) => x.kind)).toEqual(['skip', 'new']);
  });

  it('matches an entered transaction with the same amount within 10 days, closest first, one to one', () => {
    const rows = [row('2026-10-12', -4500, 'GROCER'), row('2026-10-20', -4500, 'GROCER'), row('2026-10-25', -999, 'Z')];
    const existing = [tx('far', '2026-10-01', -4500), tx('near', '2026-10-10', -4500), tx('other', '2026-10-25', -998)];
    const d = planImport({ ...base, rows, existing });
    expect(d).toEqual([
      { kind: 'match', transactionId: 'near' },
      { kind: 'new' }, // "far" is 19 days away
      { kind: 'new' },
    ]);
  });

  it('matches a scheduled transaction (same amount within 10 days of its date)', () => {
    const rows = [row('2026-11-03', -150_000, 'MORTGAGE CO')];
    const d = planImport({ ...base, rows, existing: [], scheduled: [{ scheduledId: 's1', date: '2026-11-01', amount: minor(-150_000) }] });
    expect(d).toEqual([{ kind: 'matchScheduled', scheduledId: 's1', date: '2026-11-01' }]);
  });

  it('skips transactions more than 3 days before the last reconciliation, and (if asked) before the account start', () => {
    const rows = [row('2026-09-26', -100), row('2026-09-27', -200), row('2026-08-01', -300)];
    const d = planImport({ ...base, rows, existing: [], reconciledThrough: '2026-09-30', startDate: '2026-09-01', includeBeforeStart: false });
    expect(d.map((x) => (x.kind === 'skip' ? x.reason : x.kind))).toEqual(['reconciled', 'new', 'reconciled']);
    const d2 = planImport({ ...base, rows: [row('2026-08-01', -300)], existing: [], startDate: '2026-09-01', includeBeforeStart: false });
    expect(d2).toEqual([{ kind: 'skip', reason: 'beforeStart' }]);
  });

  it('never matches a starting balance', () => {
    const d = planImport({ ...base, rows: [row('2026-10-07', 100_000, 'PAYROLL')], existing: [tx('sb', '2026-10-01', 100_000, { noMatch: true })] });
    expect(d).toEqual([{ kind: 'new' }]);
  });

  it('never matches an imported or a deleted transaction', () => {
    const rows = [row('2026-10-01', -500, 'A', { importId: 'N1' })];
    const existing = [tx('imp', '2026-10-01', -500, { importId: 'file:-500:2026-10-01:1' }), tx('del', '2026-10-01', -500, { deleted: true })];
    expect(planImport({ ...base, rows, existing })[0]?.kind).toBe('skip'); // same date+amount as an earlier CSV import
    expect(planImport({ ...base, rows, existing: [existing[1] ?? tx('', '2026-10-01', 0)] })[0]).toEqual({ kind: 'new' });
  });
});

describe('FITIDs are trusted between files that have them', () => {
  it('a new FITID with the same date and amount as an earlier FITID import is a new transaction', () => {
    const d = planImport({ reconciledThrough: null, startDate: null, includeBeforeStart: true, scheduled: [], rejected: new Set(), rows: [row('2026-10-01', -500, 'A', { importId: 'F9' })], existing: [{ id: 't', date: '2026-10-01', amount: minor(-500), importId: 'F8' }] });
    expect(d).toEqual([{ kind: 'new' }]);
  });
});
