// Golden test: rebuild a real YNAB plan from its export and match YNAB's own Activity and
// Available for every category and month, to the cent (docs/roadmap.md S1.8).
//
// The data is a public, real export kept local-only in test/fixtures/local/ynab-public-sample/
// (git-ignored: personal data under a restrictive license). Without it this suite is skipped.
// golden.json beside it holds machine-local facts the export can't express:
//   { "today": "YYYY-MM-DD",
//     "accountTypeChanges": [{ "account": "<name>", "becameCreditIn": "YYYY-MM" }],
//     "knownDifferences": [{ "category": "<Group: Category>", "months": ["YYYY-MM"], "reason": "…" }] }
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asISODate, compareMonths, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import {
  computeBudget,
  CREDIT_CARD_PAYMENTS_GROUP,
  monthState,
  parseYnabPlan,
  parseYnabRegister,
  ynabExportToSnapshot,
  type YnabRegisterRow,
} from '../src/index.ts';

interface GoldenConfig {
  today: string;
  /** Rows dated on/before `today` that YNAB had not entered yet (the export can't mark them). */
  pendingScheduled?: { date: string; amount: number; reason: string }[];
  accountTypeChanges?: { account: string; becameCreditIn: Month }[];
  knownDifferences?: { category: string; months: string[]; reason: string }[];
}

const dir = fileURLToPath(new URL('./fixtures/local/ynab-public-sample/', import.meta.url));
const present = ['Plan.csv', 'Register.csv', 'golden.json'].every((f) => existsSync(join(dir, f)));

/** Before an account became a credit card, treat its history as a separate cash account. */
function applyTypeChanges(rows: YnabRegisterRow[], config: GoldenConfig): { rows: YnabRegisterRow[]; types: Record<string, 'checking'> } {
  const types: Record<string, 'checking'> = {};
  let out = rows;
  for (const change of config.accountTypeChanges ?? []) {
    const before = `${change.account} (before credit)`;
    types[before] = 'checking';
    out = out.map((r) => {
      if (compareMonths(r.date.slice(0, 7) as Month, change.becameCreditIn) >= 0) return r;
      if (r.account === change.account) return { ...r, account: before };
      if (r.payee === `Transfer : ${change.account}`) return { ...r, payee: `Transfer : ${before}` };
      return r;
    });
  }
  return { rows: out, types };
}

describe.skipIf(!present)('golden: public YNAB export (local only)', () => {
  it('reproduces YNAB Activity and Available for every category and month', () => {
    const config = JSON.parse(readFileSync(join(dir, 'golden.json'), 'utf8')) as GoldenConfig;
    const plan = parseYnabPlan(readFileSync(join(dir, 'Plan.csv'), 'utf8'));
    const register = parseYnabRegister(readFileSync(join(dir, 'Register.csv'), 'utf8'));
    const pending = [...(config.pendingScheduled ?? [])];
    const entered = register.filter((r) => {
      const i = pending.findIndex((p) => p.date === r.date && p.amount === r.amount);
      if (i < 0) return true;
      pending.splice(i, 1);
      return false;
    });
    expect(pending, 'every pendingScheduled entry matches a register row').toEqual([]);
    const { rows, types } = applyTypeChanges(entered, config);
    const today = asISODate(config.today);
    const imported = ynabExportToSnapshot(plan, rows, { today, accountTypes: types });
    const state = computeBudget(imported.snapshot, { today });

    const known = new Set<string>();
    for (const k of config.knownDifferences ?? []) for (const m of k.months) known.add(`${k.category}|${m}`);

    const unexpected: string[] = [];
    const report: { month: string; key: string; group: string; field: string; ynab: number; hafb: number | null }[] = [];
    let compared = 0;
    let exact = 0;
    let knownHits = 0;
    for (const row of plan) {
      const id = imported.categoryIds[row.key];
      const c = id === undefined ? undefined : monthState(state, row.month).categories[id];
      compared += 2;
      const fields: [string, number, number | undefined][] = [
        ['activity', row.activity, c?.activity],
        ['available', row.available, c?.available],
      ];
      for (const [field, ynab, hafb] of fields) {
        if (ynab !== hafb) report.push({ month: row.month, key: row.key, group: row.group, field, ynab, hafb: hafb ?? null });
        if (ynab === hafb) {
          exact += 1;
        } else if (row.group === CREDIT_CARD_PAYMENTS_GROUP && known.has(`${row.key}|${row.month}`)) {
          knownHits += 1;
        } else {
          unexpected.push(`${row.month} ${row.key} ${field}: YNAB ${String(ynab)} vs HAFB ${String(hafb)}`);
        }
      }
    }
    console.info(
      `golden: ${String(exact)}/${String(compared)} values exact; ${String(knownHits)} known payment-category differences; ` +
        `${String(imported.scheduled.length)} scheduled rows excluded; ${String(plan.length)} plan rows, ${String(register.length)} register rows`,
    );
    // HAFB_GOLDEN_REPORT=1 writes every difference to the (git-ignored) fixture folder.
    if (process.env.HAFB_GOLDEN_REPORT) writeFileSync(join(dir, 'golden-report.json'), JSON.stringify(report, null, 2));
    expect(unexpected).toEqual([]);
  });
});
