// Payee commands (CLAUDE.md §4 Payee, §6.8) and the payee lookups other commands share.
import { nextDefaultCategory, ValidationError, type Id, type RenameMatch } from '@hafb/engine';
import type { PayeeRecord, PlanData, TransactionRecord } from '../records.ts';
import { Draft, requireName, type Command, type CommandContext, omit } from './context.ts';

export const STARTING_BALANCE_PAYEE = 'Starting Balance';
export const TRANSFER_PAYEE_PREFIX = 'Transfer : ';

export const transferPayeeName = (accountName: string): string => `${TRANSFER_PAYEE_PREFIX}${accountName}`;

const same = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** The live, non-transfer payee with this name (case-insensitive), created if missing. */
export function payeeByName(d: Draft, ctx: CommandContext, name: string): PayeeRecord {
  const clean = requireName(name, 'Payee');
  const found = d.all('payees').find((p) => p.deletedAt === undefined && p.transferAccountId === undefined && same(p.name, clean));
  if (found) return found;
  const payee: PayeeRecord = { id: ctx.newId(), name: clean };
  d.put('payees', payee);
  return payee;
}

/** The system payee for transfers to `accountId`. */
export function transferPayee(d: Draft, accountId: Id): PayeeRecord {
  const found = d.all('payees').find((p) => p.transferAccountId === accountId && p.deletedAt === undefined);
  if (!found) throw new ValidationError(`Account ${accountId} has no transfer payee`);
  return found;
}

function livePayee(d: Draft, id: Id): PayeeRecord {
  const p = d.get('payees', id);
  if (!p || p.deletedAt !== undefined) throw new ValidationError(`Unknown payee ${id}`);
  return p;
}

function userPayee(d: Draft, id: Id): PayeeRecord {
  const p = livePayee(d, id);
  if (p.transferAccountId !== undefined) throw new ValidationError('Transfer payees are managed by their account');
  return p;
}

/** §5.13: refresh a payee's learned default category after its transactions changed. */
export function relearnDefault(d: Draft, payeeId: Id | undefined): void {
  if (payeeId === undefined) return;
  const payee = d.get('payees', payeeId);
  if (!payee || payee.transferAccountId !== undefined || payee.deletedAt !== undefined) return;
  const history: TransactionRecord[] = d.all('transactions').filter((t) => t.payeeId === payeeId && t.deletedAt === undefined);
  const next = nextDefaultCategory(payee, history);
  const current = payee.defaultCategoryId ?? null;
  if (next === current) return;
  if (next === null) {
    const rest = omit(payee, 'defaultCategoryId');
    d.put('payees', rest);
  } else {
    d.put('payees', { ...payee, defaultCategoryId: next });
  }
}

export function renamePayee(plan: PlanData, _ctx: CommandContext, args: { payeeId: Id; name: string }): Command {
  const d = new Draft(plan);
  const payee = userPayee(d, args.payeeId);
  d.put('payees', { ...payee, name: requireName(args.name, 'Payee') });
  return { label: `Rename payee: ${payee.name}`, changes: d.build() };
}

/** Combine payees: every use of `sourceIds` moves to `targetId`; the sources are deleted. */
export function combinePayees(plan: PlanData, ctx: CommandContext, args: { sourceIds: readonly Id[]; targetId: Id }): Command {
  const d = new Draft(plan);
  const target = userPayee(d, args.targetId);
  const sources = new Set(args.sourceIds);
  if (sources.has(target.id)) throw new ValidationError('Cannot combine a payee into itself');
  for (const id of sources) {
    const p = userPayee(d, id);
    d.put('payees', { ...p, deletedAt: ctx.now });
  }
  for (const t of d.all('transactions')) {
    const payeeHit = t.payeeId !== undefined && sources.has(t.payeeId);
    const subHit = t.subtransactions?.some((s) => s.payeeId !== undefined && sources.has(s.payeeId)) ?? false;
    if (!payeeHit && !subHit) continue;
    d.put('transactions', {
      ...t,
      ...(payeeHit ? { payeeId: target.id } : {}),
      ...(t.subtransactions && subHit
        ? { subtransactions: t.subtransactions.map((s) => (s.payeeId !== undefined && sources.has(s.payeeId) ? { ...s, payeeId: target.id } : s)) }
        : {}),
    });
  }
  for (const s of d.all('scheduled')) {
    const payeeHit = s.payeeId !== undefined && sources.has(s.payeeId);
    const subHit = s.subtransactions?.some((x) => x.payeeId !== undefined && sources.has(x.payeeId)) ?? false;
    if (!payeeHit && !subHit) continue;
    d.put('scheduled', {
      ...s,
      ...(payeeHit ? { payeeId: target.id } : {}),
      ...(s.subtransactions && subHit
        ? { subtransactions: s.subtransactions.map((x) => (x.payeeId !== undefined && sources.has(x.payeeId) ? { ...x, payeeId: target.id } : x)) }
        : {}),
    });
  }
  for (const r of d.all('payeeRenameRules')) {
    if (sources.has(r.targetPayeeId)) d.put('payeeRenameRules', { ...r, targetPayeeId: target.id });
  }
  relearnDefault(d, target.id);
  return { label: `Combine payees into ${target.name}`, changes: d.build() };
}

/**
 * Delete payees (YNAB, Manage Payees): with a replacement, their transactions move to it (a
 * combine); without one, those transactions keep no payee. Rename rules pointing at them go.
 */
export function deletePayees(plan: PlanData, ctx: CommandContext, args: { payeeIds: readonly Id[]; replacementId?: Id }): Command {
  if (args.replacementId !== undefined) {
    const cmd = combinePayees(plan, ctx, { sourceIds: args.payeeIds, targetId: args.replacementId });
    return { ...cmd, label: args.payeeIds.length === 1 ? 'Delete payee' : `Delete ${String(args.payeeIds.length)} payees` };
  }
  const d = new Draft(plan);
  const gone = new Set<Id>();
  for (const id of args.payeeIds) {
    const payee = userPayee(d, id);
    d.put('payees', { ...payee, deletedAt: ctx.now });
    gone.add(payee.id);
  }
  const hit = (id: Id | undefined): boolean => id !== undefined && gone.has(id);
  for (const t of d.all('transactions')) {
    const subHit = t.subtransactions?.some((x) => hit(x.payeeId)) ?? false;
    if (!hit(t.payeeId) && !subHit) continue;
    const base = hit(t.payeeId) ? omit(t, 'payeeId') : t;
    d.put('transactions', subHit && t.subtransactions ? { ...base, subtransactions: t.subtransactions.map((x) => (hit(x.payeeId) ? omit(x, 'payeeId') : x)) } : base);
  }
  for (const s of d.all('scheduled')) {
    const subHit = s.subtransactions?.some((x) => hit(x.payeeId)) ?? false;
    if (!hit(s.payeeId) && !subHit) continue;
    const base = hit(s.payeeId) ? omit(s, 'payeeId') : s;
    d.put('scheduled', subHit && s.subtransactions ? { ...base, subtransactions: s.subtransactions.map((x) => (hit(x.payeeId) ? omit(x, 'payeeId') : x)) } : base);
  }
  for (const r of d.all('payeeRenameRules')) if (gone.has(r.targetPayeeId)) d.remove('payeeRenameRules', r.id);
  const only = args.payeeIds.length === 1 ? plan.payees.find((p) => p.id === args.payeeIds[0])?.name : undefined;
  return { label: only === undefined ? `Delete ${String(args.payeeIds.length)} payees` : `Delete payee: ${only}`, changes: d.build() };
}

export function deletePayee(plan: PlanData, ctx: CommandContext, args: { payeeId: Id; replacementId?: Id }): Command {
  return deletePayees(plan, ctx, { payeeIds: [args.payeeId], ...(args.replacementId === undefined ? {} : { replacementId: args.replacementId }) });
}

/** Hide or show payees (YNAB): hidden ones aren't suggested while typing. Transfer payees can't hide. */
export function setPayeesHidden(plan: PlanData, _ctx: CommandContext, args: { payeeIds: readonly Id[]; hidden: boolean }): Command {
  const d = new Draft(plan);
  for (const id of args.payeeIds) {
    const p = userPayee(d, id);
    d.put('payees', args.hidden ? { ...p, hidden: true } : omit(p, 'hidden'));
  }
  const n = args.payeeIds.length;
  const what = n === 1 ? 'payee' : `${String(n)} payees`;
  return { label: args.hidden ? `Hide ${what}` : `Show ${what}`, changes: d.build() };
}

/** A renaming rule (YNAB: imported payees that match are renamed to this payee; transfer payees too). */
export function addRenameRule(plan: PlanData, ctx: CommandContext, args: { payeeId: Id; match: RenameMatch; pattern: string }): Command & { ruleId: Id } {
  const d = new Draft(plan);
  const payee = livePayee(d, args.payeeId);
  const pattern = args.pattern.trim();
  if (pattern === '') throw new ValidationError('Type the text to match');
  const id = ctx.newId();
  const order = d.all('payeeRenameRules').reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
  d.put('payeeRenameRules', { id, match: args.match, pattern, targetPayeeId: payee.id, sortOrder: order });
  return { label: `Add renaming rule for ${payee.name}`, changes: d.build(), ruleId: id };
}

export function editRenameRule(plan: PlanData, _ctx: CommandContext, args: { ruleId: Id; match: RenameMatch; pattern: string }): Command {
  const d = new Draft(plan);
  const rule = d.get('payeeRenameRules', args.ruleId);
  if (!rule) throw new ValidationError(`Unknown renaming rule ${args.ruleId}`);
  const pattern = args.pattern.trim();
  if (pattern === '') throw new ValidationError('Type the text to match');
  d.put('payeeRenameRules', { ...rule, match: args.match, pattern });
  return { label: 'Edit renaming rule', changes: d.build() };
}

export function deleteRenameRule(plan: PlanData, _ctx: CommandContext, args: { ruleId: Id }): Command {
  const d = new Draft(plan);
  if (!d.get('payeeRenameRules', args.ruleId)) throw new ValidationError(`Unknown renaming rule ${args.ruleId}`);
  d.remove('payeeRenameRules', args.ruleId);
  return { label: 'Delete renaming rule', changes: d.build() };
}

/** Pin or unpin a payee's default category, or turn auto-categorizing off (§5.13). */
export function setPayeeDefaults(
  plan: PlanData,
  _ctx: CommandContext,
  args: { payeeId: Id; defaultCategoryId?: Id | null; fixed?: boolean; autoCategorize?: boolean },
): Command {
  const d = new Draft(plan);
  const p = userPayee(d, args.payeeId);
  const base = omit(p, 'defaultCategoryId', 'defaultCategoryFixed', 'autoCategorize');
  const category = args.defaultCategoryId === undefined ? p.defaultCategoryId : args.defaultCategoryId;
  const fixed = args.fixed ?? p.defaultCategoryFixed ?? false;
  const auto = args.autoCategorize ?? p.autoCategorize ?? true;
  d.put('payees', {
    ...base,
    ...(category === undefined || category === null ? {} : { defaultCategoryId: category }),
    ...(fixed ? { defaultCategoryFixed: true } : {}),
    ...(auto ? {} : { autoCategorize: false }),
  });
  return { label: `Payee settings: ${p.name}`, changes: d.build() };
}
