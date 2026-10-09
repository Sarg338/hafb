import type { ISODate, Minor } from '@hafb/shared';

/** One transaction read from a bank file, before payees and categories are resolved. */
export interface BankRow {
  date: ISODate;
  /** Signed: negative = outflow (after any "Swap Inflow and Outflow"). */
  amount: Minor;
  /** As the bank wrote it. */
  payee: string;
  memo: string;
  /** The bank's FITID (OFX/QFX); CSV and QIF rows get a synthetic id (`syntheticImportIds`). */
  importId?: string;
  checkNumber?: string;
}

export interface RowError {
  /** 1-based line in the file. */
  line: number;
  message: string;
}
