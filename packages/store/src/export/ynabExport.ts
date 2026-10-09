// Export the plan in YNAB's own format (S6.6, IE-09): a zip of "<plan> as of <date> <time> -
// Plan.csv" (Month, Category Group/Category, Category Group, Category, Assigned, Activity,
// Available for every category and month) and "... - Register.csv" (every transaction, newest
// first, splits as "Split (k/n)" rows), UTF-8 with a BOM; TSV for decimal-comma currencies.
// It is exactly the shape the YNAB importer reads (docs/ynab-references.md), so a plan can go to
// YNAB, or come back here, to the cent.
import { monthParts, type ISODate, type Month } from '@hafb/shared';
import type { PlanData } from '../records.ts';
import { planBudget } from '../snapshot.ts';
import { delimitedFor, encodeTable, exportMoney, type Cell } from './csv.ts';
import { registerRows } from './register.ts';
import { writeZip } from './zipWrite.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (m: Month): string => `${MONTHS[monthParts(m).month - 1] ?? ''} ${String(monthParts(m).year)}`;

export const PLAN_HEADER: readonly Cell[] = ['Month', 'Category Group/Category', 'Category Group', 'Category', 'Assigned', 'Activity', 'Available'];

/** Plan.csv: every live category in plan order, for every month of the plan. */
export function ynabPlanRows(plan: PlanData, today: ISODate): Cell[][] {
  const state = planBudget(plan, { today });
  const s = plan.settings;
  const groups = plan.categoryGroups.filter((g) => g.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const rows: Cell[][] = [[...PLAN_HEADER]];
  for (const month of state.months) {
    const ms = state.byMonth[month];
    if (!ms) continue;
    for (const g of groups) {
      const cats = plan.categories.filter((c) => c.groupId === g.id && c.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
      for (const c of cats) {
        const cm = ms.categories[c.id];
        if (!cm) continue;
        rows.push([monthText(month), `${g.name}: ${c.name}`, g.name, c.name, exportMoney(cm.assigned, s), exportMoney(cm.activity, s), exportMoney(cm.available, s)]);
      }
    }
  }
  return rows;
}

export interface YnabExportFile {
  /** The zip's suggested name. */
  name: string;
  bytes: Uint8Array;
  planFile: string;
  registerFile: string;
}

const utf8 = new TextEncoder();
const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Plan';

/** The YNAB-format zip; `stamp` is the local "YYYY-MM-DD HH-MM" YNAB puts in the file names. */
export function ynabExport(plan: PlanData, today: ISODate, stamp: string): YnabExportFile {
  const { delimiter } = delimitedFor(plan.settings);
  const base = `${safe(plan.settings.name)} as of ${stamp}`;
  const planFile = `${base} - Plan.csv`;
  const registerFile = `${base} - Register.csv`;
  const bytes = writeZip(
    [
      { name: planFile, bytes: utf8.encode(encodeTable(ynabPlanRows(plan, today), delimiter)) },
      { name: registerFile, bytes: utf8.encode(encodeTable(registerRows(plan), delimiter)) },
    ],
    `${stamp.slice(0, 10)}T${stamp.slice(11, 13) || '00'}:${stamp.slice(14, 16) || '00'}`,
  );
  return { name: `${base} - YNAB format.zip`, bytes, planFile, registerFile };
}

