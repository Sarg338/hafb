// Records <-> SQLite rows (ADR 0002 §3). This is the DB boundary: every value read from a file is
// validated here, so a hand-edited or corrupt file fails loudly instead of feeding the engine junk.
//
// Canonical records: optional booleans equal to their column default are omitted (`closed: false`,
// `approved: true`, `autoCategorize: true`, ...), and NULL columns are omitted fields. Decoding always
// yields canonical records; `canonical()` normalizes a hand-built one.
import { READY_TO_ASSIGN, ValidationError, type AccountType, type Assignment, type CategoryRef, type ClearedState, type FlagColor, type Frequency, type Id, type RenameMatch, type TargetBehavior, type TargetCadence } from '@hafb/engine';
import { isISODate, isMonth, minor, type ISODate, type Minor, type Month } from '@hafb/shared';
import type {
  AccountRecord,
  BuiltinFocusedView,
  CategoryGroupRecord,
  CategoryRecord,
  EntityKind,
  FlagNameRecord,
  FocusedViewRecord,
  ImportProfileRecord,
  JsonValue,
  LoanDetails,
  MoneyMoveKind,
  MoneyMoveRecord,
  MonthNoteRecord,
  PayeeRecord,
  PayeeRenameRuleRecord,
  PlanCollections,
  PlanData,
  PlanSettings,
  RecordOf,
  ReconciliationRecord,
  RejectedImportRecord,
  ScheduledSubtransactionRecord,
  ScheduledTransactionRecord,
  SubtransactionRecord,
  SymbolPlacement,
  SystemGroupKind,
  TargetRecord,
  TransactionRecord,
} from './records.ts';

// ---- wire format (shared with the Rust store, apps/desktop/src-tauri/src/store) -----------------

/** A SQLite value on the wire. REAL never appears (money is INTEGER; STRICT tables refuse floats). */
export type SqlValue = string | number | null;
export type Row = Readonly<Record<string, SqlValue>>;

/** One table as loaded: column names once, then positional rows (compact for 20k+ transactions). */
export interface TableData {
  columns: readonly string[];
  rows: readonly (readonly SqlValue[])[];
}
export type LoadedTables = Readonly<Record<string, TableData>>;

/** A batch the store applies in one SQLite transaction: all upserts, then all deletes, in order. */
export interface RowChanges {
  upserts: { table: string; rows: Row[] }[];
  deletes: { table: string; keys: Row[] }[];
}

// ---- tables ------------------------------------------------------------------------------------

export const PLAN_TABLE = 'plan';
export const SUBTRANSACTIONS_TABLE = 'subtransactions';
export const SCHEDULED_SUBTRANSACTIONS_TABLE = 'scheduled_subtransactions';

export const TABLE_OF: Readonly<Record<EntityKind, string>> = {
  accounts: 'accounts',
  categoryGroups: 'category_groups',
  categories: 'categories',
  targets: 'targets',
  payees: 'payees',
  payeeRenameRules: 'payee_rename_rules',
  scheduled: 'scheduled_transactions',
  transactions: 'transactions',
  assignments: 'month_categories',
  monthNotes: 'month_notes',
  moneyMoves: 'money_moves',
  focusedViews: 'focused_views',
  flagNames: 'flag_names',
  reconciliations: 'reconciliations',
  rejectedImports: 'rejected_imports',
  importProfiles: 'import_profiles',
};

/** Primary-key columns per table: the shape of a delete key. */
export const KEY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  plan: ['id'],
  accounts: ['id'],
  category_groups: ['id'],
  categories: ['id'],
  targets: ['category_id'],
  payees: ['id'],
  payee_rename_rules: ['id'],
  scheduled_transactions: ['id'],
  scheduled_subtransactions: ['id'],
  transactions: ['id'],
  subtransactions: ['id'],
  month_categories: ['month', 'category_id'],
  month_notes: ['month'],
  money_moves: ['id'],
  focused_views: ['id'],
  flag_names: ['color'],
  reconciliations: ['id'],
  rejected_imports: ['account_id', 'import_id'],
  import_profiles: ['account_id'],
};

/** The system rows 0001_init.sql creates; never records, never written by the codec. */
export const INFLOW_GROUP_ID = 'inflow';

// ---- value sets --------------------------------------------------------------------------------

const ACCOUNT_TYPES: readonly AccountType[] = [
  'checking', 'savings', 'cash', 'creditCard', 'lineOfCredit', 'mortgage', 'autoLoan', 'studentLoan',
  'personalLoan', 'medicalDebt', 'otherDebt', 'asset', 'liability',
];
const CLEARED: readonly ClearedState[] = ['uncleared', 'cleared', 'reconciled'];
const FLAGS: readonly FlagColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const FREQUENCIES: readonly Frequency[] = [
  'never', 'daily', 'weekly', 'everyOtherWeek', 'twiceAMonth', 'every4Weeks', 'monthly', 'everyOtherMonth',
  'every3Months', 'every4Months', 'twiceAYear', 'yearly', 'everyOtherYear',
];
const MATCHES: readonly RenameMatch[] = ['contains', 'startsWith', 'equals'];
const BEHAVIORS: readonly TargetBehavior[] = ['setAside', 'refill', 'haveBalance'];
const CADENCES: readonly TargetCadence['kind'][] = ['weekly', 'monthly', 'yearly', 'custom'];
const MOVE_KINDS: readonly MoneyMoveKind[] = ['move', 'autoAssign', 'assign', 'categoryDeleted', 'planReset'];
const BUILTIN_VIEWS: readonly BuiltinFocusedView[] = ['underfunded', 'overfunded', 'snoozed', 'moneyAvailable', 'overspent'];
const PLACEMENTS: readonly SymbolPlacement[] = ['before', 'after', 'none'];
const VISIBLE_SYSTEM_KINDS: readonly SystemGroupKind[] = ['creditCardPayments', 'hidden'];

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return values.some((v) => v === value);
}

// ---- reading -----------------------------------------------------------------------------------

function corrupt(table: string, column: string, value: unknown, expected: string): ValidationError {
  return new ValidationError(`Plan file is damaged: ${table}.${column} is ${JSON.stringify(value)}, expected ${expected}`);
}

/** Typed, validated access to one positional row. */
class Reader {
  private readonly index: Map<string, number>;
  row: readonly SqlValue[] = [];

  constructor(
    private readonly table: string,
    columns: readonly string[],
  ) {
    this.index = new Map(columns.map((c, i) => [c, i]));
  }

  private raw(column: string): SqlValue {
    const i = this.index.get(column);
    if (i === undefined) throw new ValidationError(`Plan file is damaged: ${this.table} has no column ${column}`);
    const v = this.row[i];
    if (v === undefined) throw corrupt(this.table, column, v, 'a value');
    return v;
  }

  optStr(column: string): string | undefined {
    const v = this.raw(column);
    if (v === null) return undefined;
    if (typeof v !== 'string') throw corrupt(this.table, column, v, 'text');
    return v;
  }

  str(column: string): string {
    const v = this.optStr(column);
    if (v === undefined) throw corrupt(this.table, column, null, 'text');
    return v;
  }

  optInt(column: string): number | undefined {
    const v = this.raw(column);
    if (v === null) return undefined;
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw corrupt(this.table, column, v, 'an integer');
    return v;
  }

  int(column: string): number {
    const v = this.optInt(column);
    if (v === undefined) throw corrupt(this.table, column, null, 'an integer');
    return v;
  }

  optMoney(column: string): Minor | undefined {
    const v = this.optInt(column);
    return v === undefined ? undefined : minor(v);
  }

  money(column: string): Minor {
    return minor(this.int(column));
  }

  bool(column: string): boolean {
    const v = this.int(column);
    if (v !== 0 && v !== 1) throw corrupt(this.table, column, v, '0 or 1');
    return v === 1;
  }

  optDate(column: string): ISODate | undefined {
    const v = this.optStr(column);
    if (v === undefined) return undefined;
    if (!isISODate(v)) throw corrupt(this.table, column, v, 'a YYYY-MM-DD date');
    return v;
  }

  date(column: string): ISODate {
    const v = this.optDate(column);
    if (v === undefined) throw corrupt(this.table, column, null, 'a date');
    return v;
  }

  optMonth(column: string): Month | undefined {
    const v = this.optStr(column);
    if (v === undefined) return undefined;
    if (!isMonth(v)) throw corrupt(this.table, column, v, 'a YYYY-MM month');
    return v;
  }

  month(column: string): Month {
    const v = this.optMonth(column);
    if (v === undefined) throw corrupt(this.table, column, null, 'a month');
    return v;
  }

  optOneOf<T extends string>(column: string, values: readonly T[]): T | undefined {
    const v = this.optStr(column);
    if (v === undefined) return undefined;
    if (!isOneOf(v, values)) throw corrupt(this.table, column, v, `one of ${values.join(', ')}`);
    return v;
  }

  oneOf<T extends string>(column: string, values: readonly T[]): T {
    const v = this.optOneOf(column, values);
    if (v === undefined) throw corrupt(this.table, column, null, `one of ${values.join(', ')}`);
    return v;
  }

  json(column: string): JsonValue {
    const text = this.str(column);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw corrupt(this.table, column, text, 'JSON');
    }
    if (!isJsonValue(parsed)) throw corrupt(this.table, column, text, 'JSON');
    return parsed;
  }

  stringArray(column: string): string[] {
    const v = this.json(column);
    if (!Array.isArray(v)) throw corrupt(this.table, column, v, 'a JSON array of strings');
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string') throw corrupt(this.table, column, v, 'a JSON array of strings');
      out.push(item);
    }
    return out;
  }

  monthArray(column: string): Month[] {
    const out: Month[] = [];
    for (const s of this.stringArray(column)) {
      if (!isMonth(s)) throw corrupt(this.table, column, s, 'a YYYY-MM month');
      out.push(s);
    }
    return out;
  }
}

function isJsonValue(v: unknown): v is JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (typeof v === 'object') return Object.values(v).every(isJsonValue);
  return false;
}

function rowsOf(tables: LoadedTables, table: string, read: (r: Reader) => void): void {
  const data = tables[table];
  if (!data) throw new ValidationError(`Plan file is damaged: table ${table} is missing`);
  const reader = new Reader(table, data.columns);
  for (const row of data.rows) {
    reader.row = row;
    read(reader);
  }
}

// ---- encode helpers ----------------------------------------------------------------------------

const b = (v: boolean | undefined): number => (v === true ? 1 : 0);
const n = <T>(v: T | undefined): T | null => v ?? null;

// ---- per-entity codecs -------------------------------------------------------------------------

export function encodeSettings(s: PlanSettings): Row {
  return {
    id: 1,
    name: s.name,
    currency_code: s.currencyCode,
    currency_decimals: s.currencyDecimals,
    currency_symbol: s.currencySymbol,
    symbol_placement: s.symbolPlacement,
    number_format: s.numberFormat,
    date_format: s.dateFormat,
    first_month: n(s.firstMonth),
    expected_income: n(s.expectedIncome),
    archived_at: n(s.archivedAt),
    created_at: s.createdAt,
  };
}

function decodeSettings(r: Reader): PlanSettings {
  const firstMonth = r.optMonth('first_month');
  const expectedIncome = r.optMoney('expected_income');
  const archivedAt = r.optStr('archived_at');
  return {
    name: r.str('name'),
    currencyCode: r.str('currency_code'),
    currencyDecimals: r.int('currency_decimals'),
    currencySymbol: r.str('currency_symbol'),
    symbolPlacement: r.oneOf('symbol_placement', PLACEMENTS),
    numberFormat: r.str('number_format'),
    dateFormat: r.str('date_format'),
    ...(firstMonth === undefined ? {} : { firstMonth }),
    ...(expectedIncome === undefined ? {} : { expectedIncome }),
    ...(archivedAt === undefined ? {} : { archivedAt }),
    createdAt: r.str('created_at'),
  };
}

function encodeAccount(a: AccountRecord): Row {
  const loan = a.loan ?? {};
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    on_budget: b(a.onBudget),
    closed: b(a.closed),
    starred: b(a.starred),
    note: n(a.note),
    sort_order: a.sortOrder,
    last_reconciled_at: n(a.lastReconciledAt),
    interest_rate_bps: n(loan.interestRateBps),
    minimum_payment: n(loan.minimumPayment),
    escrow: n(loan.escrow),
    fees: n(loan.fees),
    original_principal: n(loan.originalPrincipal),
    paired_category_id: n(loan.pairedCategoryId),
    created_at: a.createdAt,
    deleted_at: n(a.deletedAt),
  };
}

function decodeAccount(r: Reader): AccountRecord {
  const interestRateBps = r.optInt('interest_rate_bps');
  const minimumPayment = r.optMoney('minimum_payment');
  const escrow = r.optMoney('escrow');
  const fees = r.optMoney('fees');
  const originalPrincipal = r.optMoney('original_principal');
  const pairedCategoryId = r.optStr('paired_category_id');
  const loan: LoanDetails = {
    ...(interestRateBps === undefined ? {} : { interestRateBps }),
    ...(minimumPayment === undefined ? {} : { minimumPayment }),
    ...(escrow === undefined ? {} : { escrow }),
    ...(fees === undefined ? {} : { fees }),
    ...(originalPrincipal === undefined ? {} : { originalPrincipal }),
    ...(pairedCategoryId === undefined ? {} : { pairedCategoryId }),
  };
  const note = r.optStr('note');
  const lastReconciledAt = r.optStr('last_reconciled_at');
  const deletedAt = r.optStr('deleted_at');
  return {
    id: r.str('id'),
    name: r.str('name'),
    type: r.oneOf('type', ACCOUNT_TYPES),
    onBudget: r.bool('on_budget'),
    ...(r.bool('closed') ? { closed: true } : {}),
    ...(r.bool('starred') ? { starred: true } : {}),
    ...(note === undefined ? {} : { note }),
    sortOrder: r.int('sort_order'),
    ...(lastReconciledAt === undefined ? {} : { lastReconciledAt }),
    ...(Object.keys(loan).length === 0 ? {} : { loan }),
    createdAt: r.str('created_at'),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function encodeGroup(g: CategoryGroupRecord): Row {
  return {
    id: g.id,
    name: g.name,
    hidden: b(g.hidden),
    sort_order: g.sortOrder,
    system_kind: n(g.systemKind),
    deleted_at: n(g.deletedAt),
  };
}

function decodeGroup(r: Reader): CategoryGroupRecord {
  const systemKind = r.optOneOf('system_kind', VISIBLE_SYSTEM_KINDS);
  const deletedAt = r.optStr('deleted_at');
  return {
    id: r.str('id'),
    name: r.str('name'),
    ...(r.bool('hidden') ? { hidden: true } : {}),
    sortOrder: r.int('sort_order'),
    ...(systemKind === undefined ? {} : { systemKind }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function encodeCategory(c: CategoryRecord): Row {
  return {
    id: c.id,
    group_id: c.groupId,
    name: c.name,
    hidden: b(c.hidden),
    note: n(c.note),
    sort_order: c.sortOrder,
    credit_card_account_id: n(c.creditCardAccountId),
    deleted_at: n(c.deletedAt),
  };
}

function decodeCategory(r: Reader): CategoryRecord {
  const note = r.optStr('note');
  const creditCardAccountId = r.optStr('credit_card_account_id');
  const deletedAt = r.optStr('deleted_at');
  return {
    id: r.str('id'),
    groupId: r.str('group_id'),
    name: r.str('name'),
    ...(r.bool('hidden') ? { hidden: true } : {}),
    ...(note === undefined ? {} : { note }),
    sortOrder: r.int('sort_order'),
    ...(creditCardAccountId === undefined ? {} : { creditCardAccountId }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function encodeTarget(t: TargetRecord): Row {
  const c = t.cadence;
  return {
    category_id: t.categoryId,
    amount: t.amount,
    cadence: c.kind,
    weekday: c.kind === 'weekly' ? c.weekday : null,
    month_day: c.kind === 'monthly' ? (c.day === 'last' ? 0 : c.day) : null,
    due_date: c.kind === 'yearly' ? c.due : c.kind === 'custom' ? n(c.due) : null,
    repeat_every_months: c.kind === 'custom' ? n(c.repeatEveryMonths) : null,
    behavior: t.behavior,
    start_month: t.startMonth,
    created_on: n(t.createdOn),
    snoozed_months: JSON.stringify(t.snoozedMonths ?? []),
    updated_at: n(t.updatedAt),
  };
}

function decodeCadence(r: Reader): TargetCadence {
  const kind = r.oneOf('cadence', CADENCES);
  switch (kind) {
    case 'weekly':
      return { kind, weekday: r.int('weekday') };
    case 'monthly': {
      const day = r.int('month_day');
      return { kind, day: day === 0 ? 'last' : day };
    }
    case 'yearly':
      return { kind, due: r.date('due_date') };
    case 'custom': {
      const due = r.optDate('due_date');
      const repeatEveryMonths = r.optInt('repeat_every_months');
      return {
        kind,
        ...(due === undefined ? {} : { due }),
        ...(repeatEveryMonths === undefined ? {} : { repeatEveryMonths }),
      };
    }
  }
}

function decodeTarget(r: Reader): TargetRecord {
  const createdOn = r.optDate('created_on');
  const snoozedMonths = r.monthArray('snoozed_months');
  const updatedAt = r.optStr('updated_at');
  return {
    categoryId: r.str('category_id'),
    amount: r.money('amount'),
    cadence: decodeCadence(r),
    behavior: r.oneOf('behavior', BEHAVIORS),
    startMonth: r.month('start_month'),
    ...(createdOn === undefined ? {} : { createdOn }),
    ...(snoozedMonths.length === 0 ? {} : { snoozedMonths }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function encodePayee(p: PayeeRecord): Row {
  return {
    id: p.id,
    name: p.name,
    transfer_account_id: n(p.transferAccountId),
    default_category_id: p.defaultCategoryId ?? null,
    default_category_fixed: b(p.defaultCategoryFixed),
    auto_categorize: b(p.autoCategorize !== false),
    note: n(p.note),
    deleted_at: n(p.deletedAt),
  };
}

function decodePayee(r: Reader): PayeeRecord {
  const transferAccountId = r.optStr('transfer_account_id');
  const defaultCategoryId = r.optStr('default_category_id');
  const note = r.optStr('note');
  const deletedAt = r.optStr('deleted_at');
  return {
    id: r.str('id'),
    name: r.str('name'),
    ...(transferAccountId === undefined ? {} : { transferAccountId }),
    ...(defaultCategoryId === undefined ? {} : { defaultCategoryId }),
    ...(r.bool('default_category_fixed') ? { defaultCategoryFixed: true } : {}),
    ...(r.bool('auto_categorize') ? {} : { autoCategorize: false }),
    ...(note === undefined ? {} : { note }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function encodeRule(p: PayeeRenameRuleRecord): Row {
  return { id: p.id, match: p.match, pattern: p.pattern, target_payee_id: p.targetPayeeId, sort_order: p.sortOrder };
}

function decodeRule(r: Reader): PayeeRenameRuleRecord {
  return {
    id: r.str('id'),
    match: r.oneOf('match', MATCHES),
    pattern: r.str('pattern'),
    targetPayeeId: r.str('target_payee_id'),
    sortOrder: r.int('sort_order'),
  };
}

function encodeTransaction(t: TransactionRecord): Row {
  return {
    id: t.id,
    account_id: t.accountId,
    date: t.date,
    amount: t.amount,
    payee_id: n(t.payeeId),
    category_id: t.categoryId,
    memo: n(t.memo),
    cleared: t.cleared,
    approved: b(t.approved !== false),
    flag: n(t.flag),
    transfer_account_id: n(t.transferAccountId),
    transfer_transaction_id: n(t.transferTransactionId),
    scheduled_transaction_id: n(t.scheduledTransactionId),
    is_starting_balance: b(t.isStartingBalance),
    import_id: n(t.importId),
    imported_payee: n(t.importedPayee),
    imported_memo: n(t.importedMemo),
    created_at: t.createdAt,
    deleted_at: n(t.deletedAt),
  };
}

function decodeTransaction(r: Reader): TransactionRecord {
  const payeeId = r.optStr('payee_id');
  const memo = r.optStr('memo');
  const flag = r.optOneOf('flag', FLAGS);
  const transferAccountId = r.optStr('transfer_account_id');
  const transferTransactionId = r.optStr('transfer_transaction_id');
  const scheduledTransactionId = r.optStr('scheduled_transaction_id');
  const importId = r.optStr('import_id');
  const importedPayee = r.optStr('imported_payee');
  const importedMemo = r.optStr('imported_memo');
  const deletedAt = r.optStr('deleted_at');
  const categoryId: CategoryRef = r.optStr('category_id') ?? null;
  return {
    id: r.str('id'),
    accountId: r.str('account_id'),
    date: r.date('date'),
    amount: r.money('amount'),
    ...(payeeId === undefined ? {} : { payeeId }),
    categoryId,
    ...(memo === undefined ? {} : { memo }),
    cleared: r.oneOf('cleared', CLEARED),
    ...(r.bool('approved') ? {} : { approved: false }),
    ...(flag === undefined ? {} : { flag }),
    ...(transferAccountId === undefined ? {} : { transferAccountId }),
    ...(transferTransactionId === undefined ? {} : { transferTransactionId }),
    ...(scheduledTransactionId === undefined ? {} : { scheduledTransactionId }),
    ...(r.bool('is_starting_balance') ? { isStartingBalance: true } : {}),
    ...(importId === undefined ? {} : { importId }),
    ...(importedPayee === undefined ? {} : { importedPayee }),
    ...(importedMemo === undefined ? {} : { importedMemo }),
    createdAt: r.str('created_at'),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function encodeSub(parentId: Id, s: SubtransactionRecord, sortOrder: number): Row {
  return {
    id: s.id,
    transaction_id: parentId,
    sort_order: sortOrder,
    amount: s.amount,
    payee_id: n(s.payeeId),
    category_id: s.categoryId,
    transfer_account_id: n(s.transferAccountId),
    transfer_transaction_id: n(s.transferTransactionId),
    memo: n(s.memo),
  };
}

function decodeSub(r: Reader): { parentId: Id; sortOrder: number; sub: SubtransactionRecord } {
  const payeeId = r.optStr('payee_id');
  const transferAccountId = r.optStr('transfer_account_id');
  const transferTransactionId = r.optStr('transfer_transaction_id');
  const memo = r.optStr('memo');
  return {
    parentId: r.str('transaction_id'),
    sortOrder: r.int('sort_order'),
    sub: {
      id: r.str('id'),
      amount: r.money('amount'),
      categoryId: r.optStr('category_id') ?? null,
      ...(transferAccountId === undefined ? {} : { transferAccountId }),
      ...(memo === undefined ? {} : { memo }),
      ...(payeeId === undefined ? {} : { payeeId }),
      ...(transferTransactionId === undefined ? {} : { transferTransactionId }),
    },
  };
}

function encodeScheduled(t: ScheduledTransactionRecord): Row {
  return {
    id: t.id,
    account_id: t.accountId,
    next_date: t.date,
    frequency: t.frequency,
    anchor_day: n(t.anchorDay),
    amount: t.amount,
    payee_id: n(t.payeeId),
    category_id: t.categoryId,
    transfer_account_id: n(t.transferAccountId),
    memo: n(t.memo),
    flag: n(t.flag),
    deleted_at: n(t.deletedAt),
  };
}

function decodeScheduled(r: Reader): ScheduledTransactionRecord {
  const anchorDay = r.optInt('anchor_day');
  const payeeId = r.optStr('payee_id');
  const transferAccountId = r.optStr('transfer_account_id');
  const memo = r.optStr('memo');
  const flag = r.optOneOf('flag', FLAGS);
  const deletedAt = r.optStr('deleted_at');
  return {
    id: r.str('id'),
    accountId: r.str('account_id'),
    date: r.date('next_date'),
    frequency: r.oneOf('frequency', FREQUENCIES),
    ...(anchorDay === undefined ? {} : { anchorDay }),
    amount: r.money('amount'),
    categoryId: r.optStr('category_id') ?? null,
    ...(transferAccountId === undefined ? {} : { transferAccountId }),
    ...(payeeId === undefined ? {} : { payeeId }),
    ...(memo === undefined ? {} : { memo }),
    ...(flag === undefined ? {} : { flag }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function encodeScheduledSub(parentId: Id, s: ScheduledSubtransactionRecord, sortOrder: number): Row {
  return {
    id: s.id,
    scheduled_transaction_id: parentId,
    sort_order: sortOrder,
    amount: s.amount,
    payee_id: n(s.payeeId),
    category_id: s.categoryId,
    transfer_account_id: n(s.transferAccountId),
    memo: n(s.memo),
  };
}

function decodeScheduledSub(r: Reader): { parentId: Id; sortOrder: number; sub: ScheduledSubtransactionRecord } {
  const payeeId = r.optStr('payee_id');
  const transferAccountId = r.optStr('transfer_account_id');
  const memo = r.optStr('memo');
  return {
    parentId: r.str('scheduled_transaction_id'),
    sortOrder: r.int('sort_order'),
    sub: {
      id: r.str('id'),
      amount: r.money('amount'),
      categoryId: r.optStr('category_id') ?? null,
      ...(transferAccountId === undefined ? {} : { transferAccountId }),
      ...(memo === undefined ? {} : { memo }),
      ...(payeeId === undefined ? {} : { payeeId }),
    },
  };
}

function encodeAssignment(a: Assignment): Row {
  return { month: a.month, category_id: a.categoryId, assigned: a.assigned };
}

function decodeAssignment(r: Reader): Assignment {
  return { month: r.month('month'), categoryId: r.str('category_id'), assigned: r.money('assigned') };
}

function encodeMonthNote(m: MonthNoteRecord): Row {
  return { month: m.month, note: m.note };
}

function decodeMonthNote(r: Reader): MonthNoteRecord {
  return { month: r.month('month'), note: r.str('note') };
}

function encodeMove(m: MoneyMoveRecord): Row {
  return {
    id: m.id,
    created_at: m.createdAt,
    month: m.month,
    from_category_id: m.fromCategoryId,
    to_category_id: m.toCategoryId,
    amount: m.amount,
    kind: m.kind,
    group_id: m.groupId,
  };
}

function decodeMove(r: Reader): MoneyMoveRecord {
  return {
    id: r.str('id'),
    createdAt: r.str('created_at'),
    month: r.month('month'),
    fromCategoryId: r.optStr('from_category_id') ?? null,
    toCategoryId: r.optStr('to_category_id') ?? null,
    amount: r.money('amount'),
    kind: r.oneOf('kind', MOVE_KINDS),
    groupId: r.str('group_id'),
  };
}

function encodeView(v: FocusedViewRecord): Row {
  return { id: v.id, name: v.name, sort_order: v.sortOrder, builtin: n(v.builtin), category_ids: JSON.stringify(v.categoryIds) };
}

function decodeView(r: Reader): FocusedViewRecord {
  const builtin = r.optOneOf('builtin', BUILTIN_VIEWS);
  return {
    id: r.str('id'),
    name: r.str('name'),
    sortOrder: r.int('sort_order'),
    ...(builtin === undefined ? {} : { builtin }),
    categoryIds: r.stringArray('category_ids'),
  };
}

function encodeFlagName(f: FlagNameRecord): Row {
  return { color: f.color, name: f.name };
}

function decodeFlagName(r: Reader): FlagNameRecord {
  return { color: r.oneOf('color', FLAGS), name: r.str('name') };
}

function encodeReconciliation(x: ReconciliationRecord): Row {
  return {
    id: x.id,
    account_id: x.accountId,
    date: x.date,
    statement_balance: x.statementBalance,
    adjustment_transaction_id: n(x.adjustmentTransactionId),
    created_at: x.createdAt,
  };
}

function decodeReconciliation(r: Reader): ReconciliationRecord {
  const adjustmentTransactionId = r.optStr('adjustment_transaction_id');
  return {
    id: r.str('id'),
    accountId: r.str('account_id'),
    date: r.date('date'),
    statementBalance: r.money('statement_balance'),
    ...(adjustmentTransactionId === undefined ? {} : { adjustmentTransactionId }),
    createdAt: r.str('created_at'),
  };
}

function encodeRejected(x: RejectedImportRecord): Row {
  return { account_id: x.accountId, import_id: x.importId };
}

function decodeRejected(r: Reader): RejectedImportRecord {
  return { accountId: r.str('account_id'), importId: r.str('import_id') };
}

function encodeProfile(x: ImportProfileRecord): Row {
  return { account_id: x.accountId, profile: JSON.stringify(x.profile) };
}

function decodeProfile(r: Reader): ImportProfileRecord {
  return { accountId: r.str('account_id'), profile: r.json('profile') };
}

// ---- public API --------------------------------------------------------------------------------

/** One record as rows: its own row plus, for transactions and scheduled, its split lines. */
export interface EncodedRecord {
  table: string;
  row: Row;
  children?: { table: string; parentColumn: string; rows: Row[] };
}

type Encoders = { [P in EntityKind]: (record: RecordOf<P>) => EncodedRecord };

const ENCODERS: Encoders = {
  accounts: (r) => ({ table: TABLE_OF.accounts, row: encodeAccount(r) }),
  categoryGroups: (r) => ({ table: TABLE_OF.categoryGroups, row: encodeGroup(r) }),
  categories: (r) => ({ table: TABLE_OF.categories, row: encodeCategory(r) }),
  targets: (r) => ({ table: TABLE_OF.targets, row: encodeTarget(r) }),
  payees: (r) => ({ table: TABLE_OF.payees, row: encodePayee(r) }),
  payeeRenameRules: (r) => ({ table: TABLE_OF.payeeRenameRules, row: encodeRule(r) }),
  scheduled: (t) => ({
    table: TABLE_OF.scheduled,
    row: encodeScheduled(t),
    children: {
      table: SCHEDULED_SUBTRANSACTIONS_TABLE,
      parentColumn: 'scheduled_transaction_id',
      rows: (t.subtransactions ?? []).map((s, i) => encodeScheduledSub(t.id, s, i)),
    },
  }),
  transactions: (t) => ({
    table: TABLE_OF.transactions,
    row: encodeTransaction(t),
    children: {
      table: SUBTRANSACTIONS_TABLE,
      parentColumn: 'transaction_id',
      rows: (t.subtransactions ?? []).map((s, i) => encodeSub(t.id, s, i)),
    },
  }),
  assignments: (r) => ({ table: TABLE_OF.assignments, row: encodeAssignment(r) }),
  monthNotes: (r) => ({ table: TABLE_OF.monthNotes, row: encodeMonthNote(r) }),
  moneyMoves: (r) => ({ table: TABLE_OF.moneyMoves, row: encodeMove(r) }),
  focusedViews: (r) => ({ table: TABLE_OF.focusedViews, row: encodeView(r) }),
  flagNames: (r) => ({ table: TABLE_OF.flagNames, row: encodeFlagName(r) }),
  reconciliations: (r) => ({ table: TABLE_OF.reconciliations, row: encodeReconciliation(r) }),
  rejectedImports: (r) => ({ table: TABLE_OF.rejectedImports, row: encodeRejected(r) }),
  importProfiles: (r) => ({ table: TABLE_OF.importProfiles, row: encodeProfile(r) }),
};

export function encodeRecord<K extends EntityKind>(kind: K, record: RecordOf<K>): EncodedRecord {
  const encode: Encoders[K] = ENCODERS[kind];
  return encode(record);
}

/** The delete key (primary-key columns) of an encoded row. */
export function keyRow(table: string, row: Row): Row {
  const columns = KEY_COLUMNS[table];
  if (!columns) throw new ValidationError(`Unknown table ${table}`);
  const key: Record<string, SqlValue> = {};
  for (const c of columns) key[c] = row[c] ?? null;
  return key;
}

/** Decode a whole file. Rejects any value the schema would not produce. */
export function decodePlan(tables: LoadedTables): PlanData {
  let settings: PlanSettings | undefined;
  rowsOf(tables, PLAN_TABLE, (r) => {
    settings = decodeSettings(r);
  });
  if (!settings) throw new ValidationError('Plan file is damaged: the plan row is missing');

  const collect = <T>(table: string, decode: (r: Reader) => T, keep: (r: Reader) => boolean = () => true): T[] => {
    const out: T[] = [];
    rowsOf(tables, table, (r) => {
      if (keep(r)) out.push(decode(r));
    });
    return out;
  };

  const subs = new Map<Id, { sortOrder: number; sub: SubtransactionRecord }[]>();
  rowsOf(tables, SUBTRANSACTIONS_TABLE, (r) => {
    const { parentId, sortOrder, sub } = decodeSub(r);
    const list = subs.get(parentId) ?? [];
    list.push({ sortOrder, sub });
    subs.set(parentId, list);
  });
  const scheduledSubs = new Map<Id, { sortOrder: number; sub: ScheduledSubtransactionRecord }[]>();
  rowsOf(tables, SCHEDULED_SUBTRANSACTIONS_TABLE, (r) => {
    const { parentId, sortOrder, sub } = decodeScheduledSub(r);
    const list = scheduledSubs.get(parentId) ?? [];
    list.push({ sortOrder, sub });
    scheduledSubs.set(parentId, list);
  });
  const ordered = <S>(list: { sortOrder: number; sub: S }[]): S[] =>
    [...list].sort((a, z) => a.sortOrder - z.sortOrder).map((x) => x.sub);

  const collections: PlanCollections = {
    accounts: collect(TABLE_OF.accounts, decodeAccount),
    categoryGroups: collect(TABLE_OF.categoryGroups, decodeGroup, (r) => r.optStr('system_kind') !== 'inflow'),
    categories: collect(TABLE_OF.categories, decodeCategory, (r) => r.str('id') !== READY_TO_ASSIGN),
    targets: collect(TABLE_OF.targets, decodeTarget),
    payees: collect(TABLE_OF.payees, decodePayee),
    payeeRenameRules: collect(TABLE_OF.payeeRenameRules, decodeRule),
    scheduled: collect(TABLE_OF.scheduled, (r) => {
      const t = decodeScheduled(r);
      const lines = scheduledSubs.get(t.id);
      return lines ? { ...t, subtransactions: ordered(lines) } : t;
    }),
    transactions: collect(TABLE_OF.transactions, (r) => {
      const t = decodeTransaction(r);
      const lines = subs.get(t.id);
      return lines ? { ...t, subtransactions: ordered(lines) } : t;
    }),
    assignments: collect(TABLE_OF.assignments, decodeAssignment),
    monthNotes: collect(TABLE_OF.monthNotes, decodeMonthNote),
    moneyMoves: collect(TABLE_OF.moneyMoves, decodeMove),
    focusedViews: collect(TABLE_OF.focusedViews, decodeView),
    flagNames: collect(TABLE_OF.flagNames, decodeFlagName),
    reconciliations: collect(TABLE_OF.reconciliations, decodeReconciliation),
    rejectedImports: collect(TABLE_OF.rejectedImports, decodeRejected),
    importProfiles: collect(TABLE_OF.importProfiles, decodeProfile),
  };
  return { settings, ...collections };
}

/** Rows that write a whole plan into a freshly migrated file (create, import, Fresh Start). */
export function encodePlan(plan: PlanData): RowChanges {
  const upserts: RowChanges['upserts'] = [{ table: PLAN_TABLE, rows: [encodeSettings(plan.settings)] }];
  const children = new Map<string, Row[]>();
  for (const kind of ENCODE_ORDER) {
    const rows: Row[] = [];
    for (const record of plan[kind]) {
      const e = encodeRecord(kind, record);
      rows.push(e.row);
      if (e.children && e.children.rows.length > 0) {
        const list = children.get(e.children.table) ?? [];
        list.push(...e.children.rows);
        children.set(e.children.table, list);
      }
    }
    if (rows.length > 0) upserts.push({ table: TABLE_OF[kind], rows });
    const childTable = kind === 'transactions' ? SUBTRANSACTIONS_TABLE : kind === 'scheduled' ? SCHEDULED_SUBTRANSACTIONS_TABLE : undefined;
    const childRows = childTable === undefined ? undefined : children.get(childTable);
    if (childTable !== undefined && childRows) upserts.push({ table: childTable, rows: childRows });
  }
  return { upserts, deletes: [] };
}

/** Parents before children, so a reader of the batch sees a sensible order (FKs are deferred anyway). */
const ENCODE_ORDER: readonly EntityKind[] = [
  'accounts',
  'categoryGroups',
  'categories',
  'targets',
  'payees',
  'payeeRenameRules',
  'scheduled',
  'transactions',
  'assignments',
  'monthNotes',
  'moneyMoves',
  'focusedViews',
  'flagNames',
  'reconciliations',
  'rejectedImports',
  'importProfiles',
];

/** decode(encode(record)): the canonical form of a hand-built record. */
export function canonical<K extends EntityKind>(kind: K, record: RecordOf<K>): RecordOf<K> {
  const e = encodeRecord(kind, record);
  const columns = Object.keys(e.row);
  const tables: Record<string, TableData> = {
    [e.table]: { columns, rows: [columns.map((c) => e.row[c] ?? null)] },
  };
  if (e.children) {
    const childColumns = e.children.rows[0] ? Object.keys(e.children.rows[0]) : [];
    tables[e.children.table] = {
      columns: childColumns,
      rows: e.children.rows.map((row) => childColumns.map((c) => row[c] ?? null)),
    };
  }
  const decoded = decodeRecords(kind, tables);
  const first = decoded[0];
  if (first === undefined) throw new ValidationError(`Cannot canonicalize a ${kind} record`);
  return first;
}

/** Decode one collection from a partial table set (used by `canonical` and tests). */
export function decodeRecords<K extends EntityKind>(kind: K, tables: LoadedTables): RecordOf<K>[] {
  const settingsColumns = Object.keys(encodeSettings(PLACEHOLDER_SETTINGS));
  const empty: TableData = { columns: [], rows: [] };
  const full: Record<string, TableData> = {};
  for (const table of Object.keys(KEY_COLUMNS)) full[table] = tables[table] ?? empty;
  full[PLAN_TABLE] = { columns: settingsColumns, rows: [settingsColumns.map((c) => encodeSettings(PLACEHOLDER_SETTINGS)[c] ?? null)] };
  const plan = decodePlan(full);
  return [...plan[kind]];
}

const PLACEHOLDER_SETTINGS: PlanSettings = {
  name: '',
  currencyCode: 'USD',
  currencyDecimals: 2,
  currencySymbol: '$',
  symbolPlacement: 'before',
  numberFormat: '123,456.78',
  dateFormat: 'MM/DD/YYYY',
  createdAt: '1970-01-01T00:00:00.000Z',
};
