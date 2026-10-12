// YNAB "Export Plan" (Plan.csv + Register.csv) → a complete PlanData (ADR 0002 §8, CLAUDE.md §6.13).
// Pure: ids, "now" and "today" come from the caller. The engine parses the CSVs and rebuilds the
// budget (Phase 1, verified to the cent against real exports); this module adds everything the
// engine doesn't need but the file does: real ids, payees, transfer pairs, flags, sort orders,
// system groups, scheduled transactions and the import report.
//
// What the export can't carry (reported, never guessed silently):
//   * targets, account types (inferred), loan details, closed/starred accounts, notes, payee
//     settings and rename rules, custom flag names, approval state;
//   * how upcoming transactions repeat: each future row becomes a one-off scheduled transaction.
import {
  CREDIT_CARD_PAYMENTS_GROUP,
  detectDateOrder,
  detectNumberFormat,
  HIDDEN_CATEGORIES_GROUP,
  parseDelimited,
  parseYnabPlan,
  parseYnabRegister,
  READY_TO_ASSIGN,
  ValidationError,
  ynabExportToSnapshot,
  type AccountType,
  type CategoryRef,
  type DateOrder,
  type FlagColor,
  type Id,
  type InferredAccount,
  type NumberFormat,
  type YnabPlanRow,
  type YnabRegisterRow,
} from '@hafb/engine';
import { addMonths, compareDates, isISODate, minor, monthOf, type ISODate, type Minor } from '@hafb/shared';
import type {
  AccountRecord,
  CategoryGroupRecord,
  CategoryRecord,
  PayeeRecord,
  PlanData,
  PlanSettings,
  ScheduledSubtransactionRecord,
  ScheduledTransactionRecord,
  SubtransactionRecord,
  SymbolPlacement,
  Timestamp,
  TransactionRecord,
} from '../records.ts';

const TRANSFER_PAYEE_PREFIX = 'Transfer : ';
const SPLIT_MEMO = /^Split \((\d+)\/(\d+)\)\s?/;
const FLAG_COLORS: readonly FlagColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const LOAN_TYPES: readonly AccountType[] = ['mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt'];

// ---- finding the files -------------------------------------------------------------------------

export interface ExportFiles {
  planName: string;
  planFile: string;
  registerFile: string;
}

/**
 * Locate Plan.csv and Register.csv in an export's entries. YNAB names them
 * "<plan> as of <date> <time> - Plan.csv"; older exports used "Budget.csv" for the plan file.
 */
export function findExportFiles(names: Iterable<string>): ExportFiles {
  const all = [...names];
  const base = (n: string): string => n.split('/').pop() ?? n;
  const planFile = all.find((n) => base(n).endsWith('Plan.csv')) ?? all.find((n) => base(n).endsWith('Budget.csv'));
  const registerFile = all.find((n) => base(n).endsWith('Register.csv'));
  if (planFile === undefined || registerFile === undefined) {
    throw new ValidationError(
      `This doesn't look like a YNAB export: expected a Plan.csv and a Register.csv (found ${all.map(base).join(', ') || 'nothing'})`,
    );
  }
  const m = /^(.*?)(?: as of .*)? - (?:Plan|Budget)\.csv$/.exec(base(planFile));
  return { planName: (m?.[1] ?? '').trim(), planFile, registerFile };
}

/** The export date YNAB writes in its file names ("… as of 2026-10-08 10-55 - Plan.csv"). */
export function exportDateFromName(name: string): ISODate | undefined {
  const m = /as of (\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return undefined;
  const date = `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? ''}`;
  return isISODate(date) ? date : undefined;
}

// ---- options and report ------------------------------------------------------------------------

export interface YnabImportOptions {
  /** The export's "today": rows after it are upcoming (scheduled). */
  today: ISODate;
  now: Timestamp;
  newId: () => Id;
  planName: string;
  /** Account types by name; the export doesn't record them (e.g. { House: 'mortgage' }). */
  accountTypes?: Readonly<Record<string, AccountType>>;
  currencyCode?: string;
  currencyDecimals?: number;
  /** Overrides for the detected formats. */
  numberFormat?: NumberFormat;
  dateOrder?: DateOrder;
  currencySymbol?: string;
  symbolPlacement?: SymbolPlacement;
}

export interface ImportReport {
  counts: {
    accounts: number;
    categoryGroups: number;
    categories: number;
    payees: number;
    transactions: number;
    splits: number;
    transferPairs: number;
    scheduled: number;
    assignments: number;
    months: number;
  };
  /** How each account's type was decided (the export has no types). */
  accounts: InferredAccount[];
  /** Loan accounts: interest rate, payment and escrow aren't exported; enter them in the account. */
  loanAccountsWithoutDetails: string[];
  /** YNAB doesn't export targets (CLAUDE.md §6.13): categories to offer in the re-entry screen. */
  targetsToReenter: { categoryId: Id; group: string; name: string }[];
  /** Upcoming rows imported as one-off scheduled transactions (their repeat isn't exported). */
  scheduledWithoutRepeat: number;
  warnings: string[];
}

export interface ImportedPlan {
  plan: PlanData;
  report: ImportReport;
}

// ---- format detection --------------------------------------------------------------------------

interface DetectedFormat {
  numberFormat: NumberFormat;
  dateOrder: DateOrder;
  dateSeparator: string;
  symbol: string;
  placement: SymbolPlacement;
}

function detectFormat(registerCsv: string): DetectedFormat {
  const delimiter = (registerCsv.split('\n', 1)[0] ?? '').includes('\t') ? '\t' : ',';
  const rows = parseDelimited(registerCsv, delimiter);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const body = rows.slice(1);
  const iDate = header.indexOf('Date');
  const amounts: string[] = [];
  for (const column of ['Outflow', 'Inflow']) {
    const i = header.indexOf(column);
    if (i >= 0) for (const r of body.slice(0, 200)) amounts.push(r[i] ?? '');
  }
  const dates = iDate < 0 ? [] : body.map((r) => r[iDate] ?? '');
  const sample = amounts.find((a) => /\d/.test(a)) ?? '';
  const symbolBefore = /^\s*-?\s*([^\d\s.,()-]+)/.exec(sample)?.[1];
  const symbolAfter = /([^\d\s.,()-]+)\s*\)?\s*$/.exec(sample)?.[1];
  const symbol = symbolBefore ?? symbolAfter ?? '';
  return {
    numberFormat: detectNumberFormat(amounts.filter((a) => /\d/.test(a))),
    dateOrder: detectDateOrder(dates),
    dateSeparator: /[-/.]/.exec(dates[0] ?? '')?.[0] ?? '/',
    symbol,
    placement: symbolBefore !== undefined ? 'before' : symbolAfter !== undefined ? 'after' : 'none',
  };
}

function dateFormatOf(order: DateOrder, separator: string): string {
  const parts = order === 'YMD' ? ['YYYY', 'MM', 'DD'] : order === 'DMY' ? ['DD', 'MM', 'YYYY'] : ['MM', 'DD', 'YYYY'];
  return parts.join(separator);
}

function flagOf(text: string, warnings: string[], where: string): FlagColor | undefined {
  const t = text.trim().toLowerCase();
  if (t === '') return undefined;
  const color = FLAG_COLORS.find((c) => t === c || t.startsWith(`${c} `) || t.startsWith(`${c}(`));
  if (color === undefined) warnings.push(`Unknown flag "${text}" on ${where}; left unflagged.`);
  return color;
}

// ---- the import --------------------------------------------------------------------------------

/** Import from the two CSV texts. */
export function importYnabExport(files: { planCsv: string; registerCsv: string }, options: YnabImportOptions): ImportedPlan {
  const detected = detectFormat(files.registerCsv);
  const decimals = options.currencyDecimals ?? 2;
  const numberFormat = options.numberFormat ?? detected.numberFormat;
  const dateOrder = options.dateOrder ?? detected.dateOrder;
  const planRows = parseYnabPlan(files.planCsv, { decimals, numberFormat });
  const registerRows = parseYnabRegister(files.registerCsv, { decimals, numberFormat, dateOrder });
  const settings: Omit<PlanSettings, 'firstMonth'> = {
    name: options.planName,
    currencyCode: options.currencyCode ?? 'USD',
    currencyDecimals: decimals,
    currencySymbol: options.currencySymbol ?? (detected.symbol || '$'),
    symbolPlacement: options.symbolPlacement ?? (detected.symbol === '' ? 'before' : detected.placement),
    numberFormat: numberFormat.decimalSeparator === ',' ? '123.456,78' : '123,456.78',
    dateFormat: dateFormatOf(dateOrder, detected.dateSeparator),
    createdAt: options.now,
  };
  return importYnabRows(planRows, registerRows, settings, options);
}

/**
 * Import from parsed rows (lets tests and tools adjust rows first). `settings` is everything but
 * `firstMonth`, which comes from the plan rows.
 */
export function importYnabRows(
  planRows: readonly YnabPlanRow[],
  registerRows: readonly YnabRegisterRow[],
  settings: Omit<PlanSettings, 'firstMonth'>,
  options: YnabImportOptions,
): ImportedPlan {
  const { now, newId } = options;
  const imported = ynabExportToSnapshot(planRows, registerRows, {
    today: options.today,
    ...(options.accountTypes === undefined ? {} : { accountTypes: options.accountTypes }),
  });
  const snap = imported.snapshot;
  const warnings = [...imported.warnings];

  // ---- ids: engine ids → UUIDv7, in a stable order --------------------------------------------
  const ids = new Map<string, Id>();
  const idFor = (engineId: string): Id => {
    let id = ids.get(engineId);
    if (id === undefined) {
      id = newId();
      ids.set(engineId, id);
    }
    return id;
  };
  const mapRef = (ref: CategoryRef): CategoryRef => (ref === null || ref === READY_TO_ASSIGN ? ref : idFor(ref));

  // ---- accounts ----------------------------------------------------------------------------------
  // A loan's history already holds the interest YNAB posted: HAFB's charges start after the export.
  const chargesFrom = addMonths(monthOf(options.today), 1);
  const accounts: AccountRecord[] = snap.accounts.map((a, i) => ({
    id: idFor(a.id),
    name: a.name,
    type: a.type,
    onBudget: a.onBudget,
    sortOrder: i,
    ...(LOAN_TYPES.includes(a.type) ? { loan: { chargesFrom } } : {}),
    createdAt: now,
  }));
  const accountIdByName = new Map(snap.accounts.map((a) => [a.name, idFor(a.id)]));
  const loanAccountsWithoutDetails = snap.accounts.filter((a) => LOAN_TYPES.includes(a.type)).map((a) => a.name);

  // ---- category groups and categories (plan order) ----------------------------------------------
  const categoryGroups: CategoryGroupRecord[] = snap.categoryGroups.map((g, i) => ({
    id: idFor(g.id),
    name: g.name,
    ...(g.hidden === true ? { hidden: true } : {}),
    sortOrder: i,
    ...(g.name === CREDIT_CARD_PAYMENTS_GROUP ? { systemKind: 'creditCardPayments' as const } : {}),
    ...(g.name === HIDDEN_CATEGORIES_GROUP ? { systemKind: 'hidden' as const } : {}),
  }));
  const positionInGroup = new Map<string, number>();
  const categories: CategoryRecord[] = snap.categories.map((c) => {
    const sortOrder = positionInGroup.get(c.groupId) ?? 0;
    positionInGroup.set(c.groupId, sortOrder + 1);
    return {
      id: idFor(c.id),
      groupId: idFor(c.groupId),
      name: c.name,
      ...(c.hidden === true ? { hidden: true } : {}),
      sortOrder,
      ...(c.creditCardAccountId === undefined ? {} : { creditCardAccountId: idFor(c.creditCardAccountId) }),
    };
  });
  const groupById = new Map(snap.categoryGroups.map((g) => [g.id, g]));

  // ---- payees ------------------------------------------------------------------------------------
  // Exact-name dedupe: the export writes each payee's display name, and payees that differ only in
  // case are distinct payees in YNAB's own data (its payee list keeps both).
  const payees: PayeeRecord[] = [];
  const payeeIdByName = new Map<string, Id>();
  const transferPayeeIdByAccount = new Map<Id, Id>();
  for (const a of accounts) {
    const id = newId();
    payees.push({ id, name: `${TRANSFER_PAYEE_PREFIX}${a.name}`, transferAccountId: a.id });
    transferPayeeIdByAccount.set(a.id, id);
  }
  const payeeFor = (row: YnabRegisterRow): Id | undefined => {
    const name = row.payee;
    if (name === '') return undefined;
    if (name.startsWith(TRANSFER_PAYEE_PREFIX)) {
      const other = accountIdByName.get(name.slice(TRANSFER_PAYEE_PREFIX.length));
      if (other !== undefined) return transferPayeeIdByAccount.get(other);
    }
    let id = payeeIdByName.get(name);
    if (id === undefined) {
      id = newId();
      payeeIdByName.set(name, id);
      payees.push({ id, name });
      if (name.startsWith(TRANSFER_PAYEE_PREFIX)) {
        warnings.push(`"${name}" refers to an account that isn't in the export; imported as a regular payee.`);
      }
    }
    return id;
  };

  // ---- transactions ------------------------------------------------------------------------------
  let splits = 0;
  const transactions: TransactionRecord[] = snap.transactions.map((t) => {
    const rows = imported.sourceRows[t.id] ?? [];
    const first = rows[0];
    const where = `${first?.account ?? '?'} ${t.date}`;
    const payeeId = first === undefined ? undefined : payeeFor(first);
    const flag = first === undefined ? undefined : flagOf(first.flag, warnings, where);
    const base = {
      id: idFor(t.id),
      accountId: idFor(t.accountId),
      date: t.date,
      amount: t.amount,
      ...(payeeId === undefined ? {} : { payeeId }),
      categoryId: mapRef(t.categoryId),
      ...(t.memo === undefined ? {} : { memo: t.memo }),
      cleared: t.cleared,
      ...(flag === undefined ? {} : { flag }),
      ...(t.transferAccountId === undefined ? {} : { transferAccountId: idFor(t.transferAccountId) }),
      ...(t.isStartingBalance === true ? { isStartingBalance: true } : {}),
      createdAt: now,
    };
    if (t.subtransactions === undefined) return base;
    splits += 1;
    const subtransactions: SubtransactionRecord[] = t.subtransactions.map((s, k) => {
      const row = rows[k];
      const linePayee = row === undefined ? undefined : payeeFor(row);
      return {
        id: idFor(s.id),
        amount: s.amount,
        categoryId: mapRef(s.categoryId),
        ...(s.transferAccountId === undefined ? {} : { transferAccountId: idFor(s.transferAccountId) }),
        ...(s.memo === undefined ? {} : { memo: s.memo }),
        ...(linePayee === undefined || linePayee === payeeId ? {} : { payeeId: linePayee }),
      };
    });
    return { ...base, subtransactions };
  });

  // ---- transfer pairs ----------------------------------------------------------------------------
  // Each leg (a transaction, or a split line) pairs with the opposite leg in the other account: same
  // date, opposite amount. YNAB writes both legs; the line side of a split pairs with a whole one.
  interface Leg {
    account: Id;
    other: Id;
    date: ISODate;
    amount: Minor;
    tx: number;
    sub?: number;
  }
  const legs: Leg[] = [];
  transactions.forEach((t, tx) => {
    if (t.transferAccountId !== undefined) legs.push({ account: t.accountId, other: t.transferAccountId, date: t.date, amount: t.amount, tx });
    t.subtransactions?.forEach((s, sub) => {
      if (s.transferAccountId !== undefined) legs.push({ account: t.accountId, other: s.transferAccountId, date: t.date, amount: s.amount, tx, sub });
    });
  });
  const open = new Map<string, Leg[]>();
  const legKey = (account: Id, other: Id, date: ISODate, amount: number): string => `${account}|${other}|${date}|${String(amount)}`;
  let transferPairs = 0;
  const linkId = (leg: Leg): Id => {
    const t = transactions[leg.tx];
    if (!t) throw new ValidationError('transfer leg out of range');
    return leg.sub === undefined ? t.id : (t.subtransactions?.[leg.sub]?.id ?? t.id);
  };
  const link = (leg: Leg, otherId: Id): void => {
    const t = transactions[leg.tx];
    if (!t) return;
    if (leg.sub === undefined) {
      transactions[leg.tx] = { ...t, transferTransactionId: otherId };
    } else {
      const subs = (t.subtransactions ?? []).map((s, k) => (k === leg.sub ? { ...s, transferTransactionId: otherId } : s));
      transactions[leg.tx] = { ...t, subtransactions: subs };
    }
  };
  for (const leg of legs) {
    const waiting = open.get(legKey(leg.other, leg.account, leg.date, 0 - leg.amount));
    const partner = waiting?.find((p) => p.sub === undefined || leg.sub === undefined);
    if (waiting && partner) {
      waiting.splice(waiting.indexOf(partner), 1);
      link(leg, linkId(partner));
      link(partner, linkId(leg));
      transferPairs += 1;
    } else {
      const key = legKey(leg.account, leg.other, leg.date, leg.amount);
      open.set(key, [...(open.get(key) ?? []), leg]);
    }
  }
  const unpaired = [...open.values()].flat();
  if (unpaired.length > 0) {
    warnings.push(`${String(unpaired.length)} transfer leg(s) have no matching leg in the other account; kept unpaired.`);
  }

  // ---- scheduled (rows after today) --------------------------------------------------------------
  const scheduled = scheduledFrom(imported.scheduled, {
    accountIdByName,
    categoryIds: imported.categoryIds,
    idFor,
    newId,
    payeeFor,
    warnings,
  });

  // ---- assignments -------------------------------------------------------------------------------
  const assignments = snap.assignments.map((a) => ({ month: a.month, categoryId: idFor(a.categoryId), assigned: a.assigned }));

  // ---- report ------------------------------------------------------------------------------------
  const targetsToReenter = snap.categories
    .filter((c) => c.creditCardAccountId === undefined && c.hidden !== true)
    .filter((c) => groupById.get(c.groupId)?.hidden !== true)
    .map((c) => ({ categoryId: idFor(c.id), group: groupById.get(c.groupId)?.name ?? '', name: c.name }));
  const months = new Set(planRows.map((r) => r.month)).size;

  const plan: PlanData = {
    settings: { ...settings, ...(snap.settings.firstMonth === undefined ? {} : { firstMonth: snap.settings.firstMonth }) },
    accounts,
    categoryGroups,
    categories,
    targets: [],
    payees,
    payeeRenameRules: [],
    scheduled,
    transactions,
    assignments,
    monthNotes: [],
    moneyMoves: [],
    focusedViews: [],
    flagNames: [],
    reconciliations: [],
    rejectedImports: [],
    importProfiles: [],
  };
  return {
    plan,
    report: {
      counts: {
        accounts: accounts.length,
        categoryGroups: categoryGroups.length,
        categories: categories.length,
        payees: payees.length,
        transactions: transactions.length,
        splits,
        transferPairs,
        scheduled: scheduled.length,
        assignments: assignments.length,
        months,
      },
      accounts: imported.accounts,
      loanAccountsWithoutDetails,
      targetsToReenter,
      scheduledWithoutRepeat: scheduled.length,
      warnings,
    },
  };
}

interface ScheduledContext {
  accountIdByName: ReadonlyMap<string, Id>;
  categoryIds: Readonly<Record<string, Id>>;
  idFor: (engineId: string) => Id;
  newId: () => Id;
  payeeFor: (row: YnabRegisterRow) => Id | undefined;
  warnings: string[];
}

/**
 * Upcoming rows → one-off scheduled transactions. Split lines are recombined like the register;
 * a scheduled transfer appears once per account in the export, so only one side is kept.
 */
function scheduledFrom(rows: readonly YnabRegisterRow[], ctx: ScheduledContext): ScheduledTransactionRecord[] {
  const ref = (r: YnabRegisterRow): CategoryRef => {
    if (r.key === '') return null;
    if (r.group === 'Inflow') return READY_TO_ASSIGN;
    const engineId = ctx.categoryIds[r.key];
    if (engineId === undefined) {
      ctx.warnings.push(`Upcoming transaction on ${r.date} uses unknown category "${r.key}"; left uncategorized.`);
      return null;
    }
    return ctx.idFor(engineId);
  };
  const transferOf = (r: YnabRegisterRow): Id | undefined =>
    r.payee.startsWith(TRANSFER_PAYEE_PREFIX) ? ctx.accountIdByName.get(r.payee.slice(TRANSFER_PAYEE_PREFIX.length)) : undefined;

  const out: ScheduledTransactionRecord[] = [];
  const sorted = [...rows];
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i];
    if (!r) continue;
    const accountId = ctx.accountIdByName.get(r.account);
    if (accountId === undefined) continue;
    const split = SPLIT_MEMO.exec(r.memo);
    const n = split ? Number(split[2]) : 0;
    const parts = split?.[1] === '1' ? sorted.slice(i, i + n) : [];
    const isSplit = n > 1 && parts.length === n && parts.every((p, k) => p.account === r.account && p.date === r.date && SPLIT_MEMO.exec(p.memo)?.[1] === String(k + 1));
    const payeeId = ctx.payeeFor(r);
    const flag = flagOf(r.flag, ctx.warnings, `${r.account} ${r.date}`);
    if (isSplit) {
      let total = 0;
      const subtransactions: ScheduledSubtransactionRecord[] = parts.map((p) => {
        total += p.amount;
        const memo = p.memo.replace(SPLIT_MEMO, '').trim();
        const transfer = transferOf(p);
        const linePayee = ctx.payeeFor(p);
        return {
          id: ctx.newId(),
          amount: p.amount,
          categoryId: ref(p),
          ...(transfer === undefined ? {} : { transferAccountId: transfer }),
          ...(memo === '' ? {} : { memo }),
          ...(linePayee === undefined || linePayee === payeeId ? {} : { payeeId: linePayee }),
        };
      });
      out.push({
        id: ctx.newId(),
        accountId,
        date: r.date,
        frequency: 'never',
        amount: minor(total),
        categoryId: null,
        ...(payeeId === undefined ? {} : { payeeId }),
        ...(flag === undefined ? {} : { flag }),
        subtransactions,
      });
      i += n - 1;
      continue;
    }
    const transfer = transferOf(r);
    if (transfer !== undefined) {
      // Keep the first side seen; drop its mirror (other account, same date, opposite amount).
      const mirror = out.find(
        (s) => s.accountId === transfer && s.transferAccountId === accountId && s.date === r.date && s.amount === 0 - r.amount,
      );
      if (mirror) continue;
    }
    out.push({
      id: ctx.newId(),
      accountId,
      date: r.date,
      frequency: 'never',
      amount: r.amount,
      categoryId: transfer !== undefined && r.key === '' ? null : ref(r),
      ...(transfer === undefined ? {} : { transferAccountId: transfer }),
      ...(payeeId === undefined ? {} : { payeeId }),
      ...(r.memo === '' ? {} : { memo: r.memo }),
      ...(flag === undefined ? {} : { flag }),
    });
  }
  out.sort((a, b) => compareDates(a.date, b.date));
  return out;
}
