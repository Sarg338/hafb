// S2.4 exit criterion: an imported file reproduces YNAB's numbers. Each real export (local only,
// git-ignored; skipped when absent) goes zip/CSV → importer → the real schema (node:sqlite) → decode
// → engine, and must match YNAB exactly where the Phase 1 golden tests do.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeBudget,
  CREDIT_CARD_PAYMENTS_GROUP,
  monthState,
  parseYnabPlan,
  parseYnabRegister,
  ynabExportToSnapshot,
  type BudgetState,
  type YnabRegisterRow,
} from '@hafb/engine';
import { asISODate, compareMonths, type Month } from '@hafb/shared';
import { describe, expect, it } from 'vitest';
import { decodePlan, encodePlan } from '../src/codec.ts';
import { normalizePlan } from '../src/changes.ts';
import { exportDateFromName, findExportFiles, importYnabExport, importYnabRows } from '../src/import/ynab.ts';
import { readZip } from '../src/import/zip.ts';
import type { PlanData } from '../src/records.ts';
import { budgetSnapshot } from '../src/snapshot.ts';
import { applyRows, loadTables, openMemoryPlan } from './helpers/sqliteStore.ts';

const LOCAL = join(import.meta.dirname, '../../engine/test/fixtures/local');
const NOW = '2026-10-08T12:00:00.000Z';

function counterIds(): () => string {
  let n = 0;
  return () => `id-${String((n += 1))}`;
}

/** Write the plan through the real schema and read it back, as opening the file would. */
function throughSqlite(plan: PlanData): PlanData {
  const db = openMemoryPlan();
  applyRows(db, encodePlan(plan));
  return normalizePlan(decodePlan(loadTables(db)));
}

/** "Group: Category" → category id in an imported plan. */
function keyIndex(plan: PlanData): Map<string, string> {
  const groups = new Map(plan.categoryGroups.map((g) => [g.id, g.name]));
  return new Map(plan.categories.map((c) => [`${groups.get(c.groupId) ?? ''}: ${c.name}`, c.id]));
}

// ---- public sample ------------------------------------------------------------------------------

interface GoldenConfig {
  today: string;
  pendingScheduled?: { date: string; amount: number }[];
  accountTypeChanges?: { account: string; becameCreditIn: Month }[];
  knownDifferences?: { category: string; months: string[] }[];
}

const publicDir = join(LOCAL, 'ynab-public-sample');
const publicPresent = ['Plan.csv', 'Register.csv', 'golden.json'].every((f) => existsSync(join(publicDir, f)));

/** Same preparation as packages/engine/test/golden.test.ts (facts the export can't express). */
function prepare(register: YnabRegisterRow[], config: GoldenConfig): { rows: YnabRegisterRow[]; types: Record<string, 'checking'> } {
  const pending = [...(config.pendingScheduled ?? [])];
  let rows = register.filter((r) => {
    const i = pending.findIndex((p) => p.date === r.date && p.amount === r.amount);
    if (i < 0) return true;
    pending.splice(i, 1);
    return false;
  });
  const types: Record<string, 'checking'> = {};
  for (const change of config.accountTypeChanges ?? []) {
    const before = `${change.account} (before credit)`;
    types[before] = 'checking';
    rows = rows.map((r) => {
      if (compareMonths(asISODate(r.date).slice(0, 7) as Month, change.becameCreditIn) >= 0) return r;
      if (r.account === change.account) return { ...r, account: before };
      if (r.payee === `Transfer : ${change.account}`) return { ...r, payee: `Transfer : ${before}` };
      return r;
    });
  }
  return { rows, types };
}

describe.skipIf(!publicPresent)('import golden: public YNAB export (local only)', () => {
  it('the imported file reproduces the engine golden numbers', () => {
    const config = JSON.parse(readFileSync(join(publicDir, 'golden.json'), 'utf8')) as GoldenConfig;
    const planRows = parseYnabPlan(readFileSync(join(publicDir, 'Plan.csv'), 'utf8'));
    const { rows, types } = prepare(parseYnabRegister(readFileSync(join(publicDir, 'Register.csv'), 'utf8')), config);
    const today = asISODate(config.today);
    const { plan, report } = importYnabRows(
      planRows,
      rows,
      {
        name: 'Public sample',
        currencyCode: 'USD',
        currencyDecimals: 2,
        currencySymbol: '$',
        symbolPlacement: 'before',
        numberFormat: '123,456.78',
        dateFormat: 'MM/DD/YYYY',
        createdAt: NOW,
      },
      { today, now: NOW, newId: counterIds(), planName: 'Public sample', accountTypes: types },
    );
    const opened = throughSqlite(plan);
    expect(opened).toEqual(normalizePlan(plan));

    const state = computeBudget(budgetSnapshot(opened), { today });
    const direct = ynabExportToSnapshot(planRows, rows, { today, accountTypes: types });
    const directState = computeBudget(direct.snapshot, { today });
    const ids = keyIndex(opened);
    const known = new Set<string>();
    for (const k of config.knownDifferences ?? []) for (const m of k.months) known.add(`${k.category}|${m}`);

    let compared = 0;
    let exact = 0;
    const unexpected: string[] = [];
    const notIdentical: string[] = [];
    for (const row of planRows) {
      const id = ids.get(row.key);
      const directId = direct.categoryIds[row.key];
      expect(id, row.key).toBeDefined();
      const c = monthState(state, row.month).categories[id ?? ''];
      const d = monthState(directState, row.month).categories[directId ?? ''];
      if (c?.activity !== d?.activity || c?.available !== d?.available || c?.assigned !== d?.assigned) notIdentical.push(`${row.month} ${row.key}`);
      for (const [field, ynab, got] of [
        ['activity', row.activity, c?.activity],
        ['available', row.available, c?.available],
      ] as const) {
        compared += 1;
        if (ynab === got) exact += 1;
        else if (!(row.group === CREDIT_CARD_PAYMENTS_GROUP && known.has(`${row.key}|${row.month}`))) {
          unexpected.push(`${row.month} ${row.key} ${field}: YNAB ${String(ynab)} vs imported ${String(got)}`);
        }
      }
    }
    for (const m of new Set(planRows.map((r) => r.month))) {
      expect(monthState(state, m).readyToAssign, m).toBe(monthState(directState, m).readyToAssign);
    }
    console.info(
      `import golden (public): ${String(exact)}/${String(compared)} values exact; ${String(report.counts.transactions)} transactions, ` +
        `${String(report.counts.transferPairs)} transfer pairs, ${String(report.counts.payees)} payees, ${String(report.warnings.length)} warnings`,
    );
    expect(notIdentical).toEqual([]);
    expect(unexpected).toEqual([]);
  });
});

// ---- Sarg's trial export, straight from the zip --------------------------------------------------

const trialDir = join(LOCAL, 'ynab-trial');
const trialZip = existsSync(trialDir) ? readdirSync(trialDir).find((f) => f.endsWith('.zip')) : undefined;
const trialPresent = trialZip !== undefined && existsSync(join(trialDir, 'observed.json'));

interface Observed {
  today: string;
  readyToAssign: Record<string, number>;
  summary: Record<string, { assigned: number; activity: number; available: number }>;
}

describe.skipIf(!trialPresent)('import golden: Sarg’s YNAB trial export (local only)', () => {
  it('zip → file → engine matches every value YNAB showed', async () => {
    const obs = JSON.parse(readFileSync(join(trialDir, 'observed.json'), 'utf8')) as Observed;
    const entries = await readZip(new Uint8Array(readFileSync(join(trialDir, trialZip ?? ''))));
    const files = findExportFiles(entries.keys());
    const text = (name: string) => new TextDecoder().decode(entries.get(name));
    const today = exportDateFromName(files.planFile);
    expect(today).toBe(obs.today);
    const { plan, report } = importYnabExport(
      { planCsv: text(files.planFile), registerCsv: text(files.registerFile) },
      { today: asISODate(obs.today), now: NOW, newId: counterIds(), planName: files.planName, accountTypes: { house: 'mortgage' } },
    );
    const opened = throughSqlite(plan);
    expect(opened).toEqual(normalizePlan(plan));

    const state: BudgetState = computeBudget(budgetSnapshot(opened), { today: asISODate(obs.today), throughMonth: '2026-11' });
    const ids = keyIndex(opened);
    const planRows = parseYnabPlan(text(files.planFile));
    for (const row of planRows) {
      const c = monthState(state, row.month).categories[ids.get(row.key) ?? ''];
      expect({ key: row.key, activity: c?.activity, available: c?.available }).toEqual({ key: row.key, activity: row.activity, available: row.available });
    }
    for (const [m, v] of Object.entries(obs.readyToAssign)) expect([m, monthState(state, m as Month).readyToAssign]).toEqual([m, v]);
    for (const [m, s] of Object.entries(obs.summary)) {
      const t = monthState(state, m as Month).totals;
      expect({ m, assigned: t.assigned, activity: t.activity, available: t.available }).toEqual({ m, assigned: s.assigned, activity: s.activity, available: s.available });
    }
    expect(report.loanAccountsWithoutDetails).toEqual(['house']);
    expect(report.warnings).toEqual([]);
    console.info(
      `import golden (trial): ${String(planRows.length * 2)} plan values exact; ${String(report.counts.transactions)} transactions, ` +
        `${String(report.counts.scheduled)} scheduled, ${String(report.targetsToReenter.length)} targets to re-enter`,
    );
  });
});
