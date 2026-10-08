// The persisted plan, record by record (CLAUDE.md §4, ADR 0002). A PlanData is an exact mirror of
// one .hafb file, soft-deleted rows included; `budgetSnapshot` derives what the engine computes on.
//
// Records extend the engine types, so live records can be handed to the engine without copying.
// Soft deletes are `deletedAt` (the column is the truth); the engine never sees deleted records.
import type {
  Account,
  Assignment,
  Category,
  CategoryGroup,
  FlagColor,
  Id,
  Payee,
  PayeeRenameRule,
  ScheduledTransaction,
  Subtransaction,
  Target,
  Transaction,
} from '@hafb/engine';
import type { ISODate, Minor, Month } from '@hafb/shared';

/** ISO 8601 UTC timestamp, 'YYYY-MM-DDTHH:MM:SS.sssZ'. Supplied by the caller (pure package). */
export type Timestamp = string;

export type SymbolPlacement = 'before' | 'after' | 'none';

export interface PlanSettings {
  name: string;
  /** ISO 4217. */
  currencyCode: string;
  currencyDecimals: number;
  currencySymbol: string;
  symbolPlacement: SymbolPlacement;
  /** YNAB's sample notation: '123,456.78', '123.456,78', … */
  numberFormat: string;
  /** 'YYYY-MM-DD', 'MM/DD/YYYY', … */
  dateFormat: string;
  firstMonth?: Month;
  /** Cost to Be Me: expected monthly income. */
  expectedIncome?: Minor;
  /** Set on the old plan by Fresh Start. */
  archivedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface LoanDetails {
  interestRateBps?: number;
  minimumPayment?: Minor;
  escrow?: Minor;
  fees?: Minor;
  originalPrincipal?: Minor;
  pairedCategoryId?: Id;
}

export interface AccountRecord extends Account {
  starred?: boolean;
  note?: string;
  sortOrder: number;
  lastReconciledAt?: Timestamp;
  /** Loan accounts only. */
  loan?: LoanDetails;
  createdAt: Timestamp;
  deletedAt?: Timestamp;
}

/** The two visible system groups. The Inflow group (Ready to Assign) never appears as a record. */
export type SystemGroupKind = 'creditCardPayments' | 'hidden';

export interface CategoryGroupRecord extends CategoryGroup {
  sortOrder: number;
  systemKind?: SystemGroupKind;
  deletedAt?: Timestamp;
}

export interface CategoryRecord extends Category {
  note?: string;
  sortOrder: number;
  deletedAt?: Timestamp;
}

export interface TargetRecord extends Target {
  updatedAt?: Timestamp;
}

export interface PayeeRecord extends Payee {
  note?: string;
  deletedAt?: Timestamp;
}

export interface PayeeRenameRuleRecord extends PayeeRenameRule {
  sortOrder: number;
}

export interface SubtransactionRecord extends Subtransaction {
  /** Optional payee override for this line. */
  payeeId?: Id;
  /** For a transfer line: the other leg's transaction id. */
  transferTransactionId?: Id;
}

export interface TransactionRecord extends Transaction {
  subtransactions?: readonly SubtransactionRecord[];
  flag?: FlagColor;
  /** The other leg of a transfer (a transaction, or a subtransaction of a split). */
  transferTransactionId?: Id;
  scheduledTransactionId?: Id;
  importId?: string;
  importedPayee?: string;
  importedMemo?: string;
  createdAt: Timestamp;
  deletedAt?: Timestamp;
}

export interface ScheduledSubtransactionRecord extends Subtransaction {
  payeeId?: Id;
}

export interface ScheduledTransactionRecord extends ScheduledTransaction {
  subtransactions?: readonly ScheduledSubtransactionRecord[];
  flag?: FlagColor;
  deletedAt?: Timestamp;
}

export interface MonthNoteRecord {
  month: Month;
  note: string;
}

export type MoneyMoveKind = 'move' | 'autoAssign' | 'assign' | 'categoryDeleted' | 'planReset';

export interface MoneyMoveRecord {
  id: Id;
  createdAt: Timestamp;
  month: Month;
  /** null = Ready to Assign. */
  fromCategoryId: Id | null;
  toCategoryId: Id | null;
  /** Positive. */
  amount: Minor;
  kind: MoneyMoveKind;
  /** Moves made by one action share a group id. */
  groupId: Id;
}

export type BuiltinFocusedView = 'underfunded' | 'overfunded' | 'snoozed' | 'moneyAvailable' | 'overspent';

export interface FocusedViewRecord {
  id: Id;
  name: string;
  sortOrder: number;
  builtin?: BuiltinFocusedView;
  categoryIds: readonly Id[];
}

export interface FlagNameRecord {
  color: FlagColor;
  name: string;
}

export interface ReconciliationRecord {
  id: Id;
  accountId: Id;
  date: ISODate;
  statementBalance: Minor;
  adjustmentTransactionId?: Id;
  createdAt: Timestamp;
}

export interface RejectedImportRecord {
  accountId: Id;
  importId: string;
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ImportProfileRecord {
  accountId: Id;
  profile: JsonValue;
}

/** Every keyed collection in a plan. Each maps 1:1 to a table (splits ride with their parent). */
export interface PlanCollections {
  accounts: readonly AccountRecord[];
  categoryGroups: readonly CategoryGroupRecord[];
  categories: readonly CategoryRecord[];
  targets: readonly TargetRecord[];
  payees: readonly PayeeRecord[];
  payeeRenameRules: readonly PayeeRenameRuleRecord[];
  scheduled: readonly ScheduledTransactionRecord[];
  transactions: readonly TransactionRecord[];
  assignments: readonly Assignment[];
  monthNotes: readonly MonthNoteRecord[];
  moneyMoves: readonly MoneyMoveRecord[];
  focusedViews: readonly FocusedViewRecord[];
  flagNames: readonly FlagNameRecord[];
  reconciliations: readonly ReconciliationRecord[];
  rejectedImports: readonly RejectedImportRecord[];
  importProfiles: readonly ImportProfileRecord[];
}

export type EntityKind = keyof PlanCollections;
export type RecordOf<K extends EntityKind> = PlanCollections[K][number];

export interface PlanData extends PlanCollections {
  settings: PlanSettings;
}

export const ENTITY_KINDS: readonly EntityKind[] = [
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

/** A record's identity within its collection. */
export function keyOf<K extends EntityKind>(kind: K, record: RecordOf<K>): string {
  const r: Partial<Record<string, unknown>> = { ...record };
  switch (kind) {
    case 'targets':
      return String(r.categoryId);
    case 'assignments':
      return `${String(r.month)}|${String(r.categoryId)}`;
    case 'monthNotes':
      return String(r.month);
    case 'flagNames':
      return String(r.color);
    case 'rejectedImports':
      return `${String(r.accountId)}|${String(r.importId)}`;
    case 'importProfiles':
      return String(r.accountId);
    default:
      return String(r.id);
  }
}

export function emptyPlan(settings: PlanSettings): PlanData {
  return {
    settings,
    accounts: [],
    categoryGroups: [],
    categories: [],
    targets: [],
    payees: [],
    payeeRenameRules: [],
    scheduled: [],
    transactions: [],
    assignments: [],
    monthNotes: [],
    moneyMoves: [],
    focusedViews: [],
    flagNames: [],
    reconciliations: [],
    rejectedImports: [],
    importProfiles: [],
  };
}
