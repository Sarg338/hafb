// Optional bank sync through SimpleFIN Bridge (S8.6, ADR 0006). Rust fetches SimpleFIN's answer
// (src-tauri/src/bank_sync.rs); this reads it and imports it through the same pipeline as bank
// files (S6.5, §5.12): unapproved, auto-matched, renaming rules, rejected imports never return,
// the reconciliation skip rule, cash inflows to Ready to Assign. Pending transactions are never
// imported (ADR 0006 §8).
//
// SimpleFIN protocol v2 (https://www.simplefin.org/protocol.html): an account set has `errlist`
// (always shown to the user), `connections` and `accounts`; each transaction has an id unique
// within its account, `posted` and optional `transacted_at` (Unix times), a decimal-string
// `amount` (positive = money in) and `description`. SimpleFIN Bridge also sends a cleaned `payee`.
import { parseBankAmount, ValidationError, type BankRow, type Id } from '@hafb/engine';
import type { ISODate } from '@hafb/shared';
import { applyChanges, mergeChangeSets } from '../changes.ts';
import type { AccountRecord, PlanData } from '../records.ts';
import { importBankRows } from './bankImport.ts';
import { Draft, liveAccount, omit, type Command, type CommandContext } from './context.ts';

export interface SimplefinTransaction {
  id: string;
  posted: number;
  transactedAt?: number;
  amount: string;
  description: string;
  payee?: string;
  pending: boolean;
}

export interface SimplefinAccount {
  id: string;
  /** With the bank's name: "Regions Bank · Checking". */
  name: string;
  currency: string;
  balance: string;
  transactions: SimplefinTransaction[];
}

export interface SimplefinAnswer {
  accounts: SimplefinAccount[];
  /** SimpleFIN's messages for the user (connection problems, rate-limit warnings). */
  messages: string[];
}

const IMPORT_ID_PREFIX = 'sfin:';
/** SimpleFIN text is outside data: no control characters, and a sane length. */
const clean = (s: string, max = 200): string =>
  s
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === 'string' ? o[k] : undefined);
const num = (o: Record<string, unknown>, k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] : undefined);

/** SimpleFIN's JSON as HAFB uses it. Malformed transactions are dropped; a malformed answer throws. */
export function readSimplefin(json: unknown): SimplefinAnswer {
  if (!isRecord(json) || !Array.isArray(json.accounts)) throw new ValidationError('SimpleFIN sent an answer HAFB couldn’t read.');
  const messages = new Set<string>();
  for (const e of Array.isArray(json.errlist) ? json.errlist : []) {
    const msg = isRecord(e) ? str(e, 'msg') : undefined;
    if (msg !== undefined && clean(msg) !== '') messages.add(clean(msg, 500));
  }
  for (const e of Array.isArray(json.errors) ? json.errors : []) {
    if (typeof e === 'string' && clean(e) !== '') messages.add(clean(e, 500));
  }
  const orgs = new Map<string, string>();
  for (const c of Array.isArray(json.connections) ? json.connections : []) {
    if (!isRecord(c)) continue;
    const id = str(c, 'conn_id');
    const name = str(c, 'org_name') ?? str(c, 'name');
    if (id !== undefined && name !== undefined) orgs.set(id, clean(name));
  }
  const accounts: SimplefinAccount[] = [];
  for (const a of json.accounts) {
    if (!isRecord(a)) continue;
    const id = str(a, 'id');
    const name = str(a, 'name');
    if (id === undefined || id === '' || name === undefined) continue;
    const org = orgs.get(str(a, 'conn_id') ?? '') ?? (isRecord(a.org) ? str(a.org, 'name') : undefined);
    const transactions: SimplefinTransaction[] = [];
    for (const t of Array.isArray(a.transactions) ? a.transactions : []) {
      if (!isRecord(t)) continue;
      const tid = str(t, 'id');
      const posted = num(t, 'posted');
      const amount = str(t, 'amount');
      if (tid === undefined || tid === '' || posted === undefined || amount === undefined) continue;
      const transactedAt = num(t, 'transacted_at');
      const payee = str(t, 'payee');
      transactions.push({
        id: tid,
        posted,
        ...(transactedAt === undefined || transactedAt <= 0 ? {} : { transactedAt }),
        amount,
        description: clean(str(t, 'description') ?? ''),
        ...(payee === undefined || clean(payee) === '' ? {} : { payee: clean(payee) }),
        pending: t.pending === true || posted <= 0,
      });
    }
    accounts.push({
      id,
      name: org === undefined || org === '' ? clean(name) : `${clean(org)} · ${clean(name)}`,
      currency: (str(a, 'currency') ?? '').trim().toUpperCase(),
      balance: str(a, 'balance') ?? '0',
      transactions,
    });
  }
  return { accounts, messages: [...messages] };
}

/** Answers for several date windows as one: each account once, each transaction once, messages once. */
export function mergeSimplefin(answers: readonly SimplefinAnswer[]): SimplefinAnswer {
  const accounts = new Map<string, SimplefinAccount>();
  const messages = new Set<string>();
  for (const answer of answers) {
    for (const m of answer.messages) messages.add(m);
    for (const a of answer.accounts) {
      const seen = accounts.get(a.id);
      if (!seen) {
        accounts.set(a.id, { ...a, transactions: [...a.transactions] });
        continue;
      }
      const ids = new Set(seen.transactions.map((t) => t.id));
      // The later answer's name and balance are the newer ones.
      accounts.set(a.id, { ...a, transactions: [...seen.transactions, ...a.transactions.filter((t) => !ids.has(t.id))] });
    }
  }
  return { accounts: [...accounts.values()], messages: [...messages] };
}

/**
 * A SimpleFIN account's posted transactions as bank rows. The date is when the purchase happened
 * (`transacted_at`) when SimpleFIN knows it, else when it posted; `dateOf` turns a Unix time into
 * a local calendar date. Amounts go from decimal text straight to minor units. Rows whose amount
 * can't be read are left out and counted.
 */
export function simplefinRows(account: SimplefinAccount, decimals: number, dateOf: (unixSeconds: number) => ISODate): { rows: BankRow[]; unreadable: number } {
  const rows: BankRow[] = [];
  let unreadable = 0;
  for (const t of account.transactions) {
    if (t.pending) continue;
    let amount;
    try {
      amount = parseBankAmount(t.amount, '.', decimals);
    } catch {
      unreadable += 1;
      continue;
    }
    rows.push({ date: dateOf(t.transactedAt ?? t.posted), amount, payee: t.payee ?? t.description, memo: '', importId: `${IMPORT_ID_PREFIX}${t.id}` });
  }
  return { rows, unreadable };
}

export const isBankSyncImportId = (id: string): boolean => id.startsWith(IMPORT_ID_PREFIX);

/** Live, open accounts linked for bank sync. */
export function linkedAccounts(plan: PlanData): AccountRecord[] {
  return plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true && a.bankLink !== undefined);
}

/** Link an account to a SimpleFIN account, or unlink it (`link` null). One SimpleFIN account links to one account. */
export function linkBankAccount(plan: PlanData, _ctx: CommandContext, args: { accountId: Id; link: { id: string; name: string } | null }): Command {
  const d = new Draft(plan);
  const a = liveAccount(d, args.accountId);
  if (args.link === null) {
    if (a.bankLink === undefined) return { label: `Unlink ${a.name}`, changes: {} };
    d.put('accounts', omit(a, 'bankLink'));
    return { label: `Unlink ${a.name}`, changes: d.build() };
  }
  const { id, name } = args.link;
  const taken = d.all('accounts').find((o) => o.id !== a.id && o.deletedAt === undefined && o.bankLink?.id === id);
  if (taken) throw new ValidationError(`That bank account is already linked to ${taken.name}`);
  if (a.closed === true) throw new ValidationError(`Reopen ${a.name} before linking it`);
  // A new link starts fresh; relinking the same account keeps when it last synced.
  d.put('accounts', { ...a, bankLink: { id, name: clean(name), ...(a.bankLink?.id === id && a.bankLink.syncedAt !== undefined ? { syncedAt: a.bankLink.syncedAt } : {}) } });
  return { label: `Link ${a.name} to ${clean(name)}`, changes: d.build() };
}

export interface BankSyncAccountReport {
  accountId: Id;
  imported: number;
  matched: number;
  paired: number;
}

export interface BankSyncReport {
  accounts: BankSyncAccountReport[];
  /** SimpleFIN's messages, plus HAFB's about accounts it couldn't sync. Show them all. */
  messages: string[];
}

/**
 * Import SimpleFIN's answer into every linked account. Returns null changes when nothing came in,
 * so a sync with nothing new isn't an undo step. When something did, it's one undo step, and every
 * linked account SimpleFIN answered for records the time (the next sync asks from 5 days before it).
 */
export function syncBankAccounts(
  plan: PlanData,
  ctx: CommandContext,
  args: { answer: SimplefinAnswer; dateOf: (unixSeconds: number) => ISODate },
): { command: Command | null; report: BankSyncReport } {
  const report: BankSyncReport = { accounts: [], messages: [...args.answer.messages] };
  const remote = new Map(args.answer.accounts.map((a) => [a.id, a]));
  const decimals = plan.settings.currencyDecimals;
  let current = plan;
  const sets: Command['changes'][] = [];
  const answered: Id[] = [];
  for (const account of linkedAccounts(plan)) {
    const link = account.bankLink;
    if (!link) continue;
    const source = remote.get(link.id);
    if (!source) {
      report.messages.push(`SimpleFIN didn’t send ${account.name} (${link.name}). Check the connection on SimpleFIN’s site, or link the account again in Edit Account.`);
      continue;
    }
    if (source.currency !== '' && source.currency !== plan.settings.currencyCode) {
      report.messages.push(`${account.name} wasn’t synced: SimpleFIN sends it in ${source.currency}, and this plan uses ${plan.settings.currencyCode}.`);
      continue;
    }
    answered.push(account.id);
    const { rows, unreadable } = simplefinRows(source, decimals, args.dateOf);
    if (unreadable > 0) report.messages.push(`${String(unreadable)} transaction${unreadable === 1 ? '' : 's'} for ${account.name} had an amount HAFB couldn’t read and ${unreadable === 1 ? 'was' : 'were'} left out.`);
    if (rows.length === 0) continue;
    const cmd = importBankRows(current, ctx, { accountId: account.id, rows, includeBeforeStart: false });
    if (cmd.report.imported + cmd.report.matched > 0) {
      sets.push(cmd.changes);
      current = applyChanges(current, cmd.changes).plan;
    }
    report.accounts.push({ accountId: account.id, imported: cmd.report.imported, matched: cmd.report.matched, paired: cmd.report.paired });
  }
  if (sets.length === 0) return { command: null, report };
  const d = new Draft(current);
  for (const id of answered) {
    const a = d.get('accounts', id);
    if (a?.bankLink) d.put('accounts', { ...a, bankLink: { ...a.bankLink, syncedAt: ctx.now } });
  }
  sets.push(d.build());
  const n = report.accounts.reduce((s, r) => s + r.imported + r.matched, 0);
  return { command: { label: `Sync ${String(n)} transaction${n === 1 ? '' : 's'} from the bank`, changes: mergeChangeSets(...sets) }, report };
}
