// S4.1 exit check helpers: read every row of the Plan grid as shown (scrolling the virtualized
// grid), and compute what the engine says those rows should show.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { formatMoney, makeDate, uuidv7Generator, type ISODate, type Minor, type Month } from '@hafb/shared';
import { exportDateFromName, findExportFiles, importYnabExport, readZip, type PlanData } from '@hafb/store';
import { planModel } from '../src/screens/plan/planModel.ts';
import { planRows } from '../src/screens/plan/planRows.ts';

export function todayLocal(): ISODate {
  const d = new Date();
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** A YNAB export (a zip, or a folder with Plan.csv and Register.csv) imported as the app does. */
export async function importExport(path: string): Promise<PlanData> {
  if (statSync(path).isDirectory()) {
    return importCsvs(readFileSync(join(path, 'Plan.csv'), 'utf8'), readFileSync(join(path, 'Register.csv'), 'utf8'), undefined);
  }
  const entries = await readZip(new Uint8Array(readFileSync(path)));
  const files = findExportFiles(entries.keys());
  const text = (name: string): string => new TextDecoder('utf-8').decode(entries.get(name));
  return importCsvs(text(files.planFile), text(files.registerFile), exportDateFromName(files.planFile));
}

function importCsvs(planCsv: string, registerCsv: string, exportDate: ISODate | undefined): PlanData {
  let clock = Date.UTC(2026, 9, 8);
  const newId = uuidv7Generator(
    () => (clock += 1),
    (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + clock) % 256),
  );
  const today = todayLocal();
  const { plan } = importYnabExport(
    { planCsv, registerCsv },
    { today: exportDate ?? today, now: new Date().toISOString(), newId, planName: 'Imported plan' },
  );
  return plan;
}

/** Spaces as a sighted user sees them (formatting may use non-breaking spaces). */
export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

export interface ShownRow {
  id: string;
  name: string;
  assigned: string;
  activity: string;
  available: string;
}

/** What the engine says every row (groups and categories) should show for a month. */
export function expectedRows(plan: PlanData, month: Month, today: ISODate): ShownRow[] {
  const model = planModel(plan, month, today);
  const money = (m: Minor): string => norm(formatMoney(m, model.fmt));
  return planRows(model, 'all').map((r) => ({
    id: r.id,
    name: r.data.name,
    assigned: money(r.data.assigned),
    activity: money(r.data.activity),
    available: money(r.data.available),
  }));
}

export function expectedReadyToAssign(plan: PlanData, month: Month, today: ISODate): string {
  const model = planModel(plan, month, today);
  return norm(formatMoney(model.ms.readyToAssign, model.fmt));
}

/** Scroll the grid top to bottom and read every rendered row's cells. */
export async function readGrid(page: Page): Promise<ShownRow[]> {
  return page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>('[role=treegrid][aria-label="Categories"], [role=grid][aria-label="Categories"]');
    if (!grid) throw new Error('no Categories grid');
    const seen = new Map<string, { id: string; name: string; assigned: string; activity: string; available: string }>();
    // The text a sighted user reads: screen-reader-only labels ("funded: ") are left out.
    const money = (el: Element | null): string => {
      if (!el) return '';
      const copy = el.cloneNode(true);
      if (!(copy instanceof Element)) return '';
      for (const hidden of copy.querySelectorAll('.visually-hidden, [data-part=label]')) hidden.remove();
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };
    const read = (): void => {
      for (const row of grid.querySelectorAll<HTMLElement>('[role=row][data-row-id]')) {
        const id = row.dataset.rowId ?? '';
        const nameEl = row.querySelector('[data-col=category]');
        const name = (nameEl?.querySelector('[class*=name]') ?? nameEl)?.textContent.trim() ?? '';
        seen.set(id, {
          id,
          name,
          assigned: money(row.querySelector('[data-col=assigned]')),
          activity: money(row.querySelector('[data-col=activity]')),
          available: money(row.querySelector('[data-col=available]')),
        });
      }
    };
    grid.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let guard = 0; guard < 400; guard++) {
      read();
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1) break;
      grid.scrollTop += Math.max(100, grid.clientHeight - 80);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    read();
    return [...seen.values()];
  });
}
