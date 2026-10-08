// Everything the Plan screen and inspector read for one month, computed once per plan object.
import { evaluateTargets, type BudgetState, type Id, type MonthState, type Target, type TargetMonth } from '@hafb/engine';
import { ZERO, type ISODate, type Minor, type MoneyFormat, type Month } from '@hafb/shared';
import { planBudget, type CategoryGroupRecord, type CategoryRecord, type PlanData } from '@hafb/store';
import { categoryView, type CategoryView } from './planView.ts';

export interface PlanModel {
  plan: PlanData;
  month: Month;
  today: ISODate;
  fmt: MoneyFormat;
  state: BudgetState;
  ms: MonthState;
  groups: { group: CategoryGroupRecord; categories: CategoryRecord[] }[];
  targets: Map<Id, Target>;
  evaluated: Record<Id, TargetMonth>;
  views: Map<Id, CategoryView>;
  paymentIds: Set<Id>;
  assignedFor: (categoryId: Id, month: Month) => Minor;
}

const cache = new WeakMap<PlanData, Map<string, PlanModel>>();

export function moneyFormat(plan: PlanData): MoneyFormat {
  const s = plan.settings;
  return { decimals: s.currencyDecimals, symbol: s.currencySymbol, placement: s.symbolPlacement, numberFormat: s.numberFormat };
}

export function planModel(plan: PlanData, month: Month, today: ISODate): PlanModel {
  let byKey = cache.get(plan);
  if (!byKey) {
    byKey = new Map();
    cache.set(plan, byKey);
  }
  const key = `${month}|${today}`;
  const hit = byKey.get(key);
  if (hit) return hit;

  const state = planBudget(plan, { today, throughMonth: month });
  const ms = state.byMonth[month];
  if (!ms) throw new Error(`No plan data for ${month}`);
  const fmt = moneyFormat(plan);
  const live = <T extends { deletedAt?: string }>(xs: readonly T[]): T[] => xs.filter((x) => x.deletedAt === undefined);
  const groups = live(plan.categoryGroups)
    .toSorted((a, b) => Number(a.systemKind === 'hidden') - Number(b.systemKind === 'hidden') || a.sortOrder - b.sortOrder)
    .map((group) => ({
      group,
      categories: live(plan.categories)
        .filter((c) => c.groupId === group.id)
        .toSorted((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((g) => g.categories.length > 0 || g.group.systemKind === undefined);
  const assignments = new Map(plan.assignments.map((a) => [`${a.month}|${a.categoryId}`, a.assigned]));
  const assignedFor = (categoryId: Id, m: Month): Minor => assignments.get(`${m}|${categoryId}`) ?? ZERO;
  const liveCats = new Set(live(plan.categories).map((c) => c.id));
  const targetList = plan.targets.filter((t) => liveCats.has(t.categoryId));
  const targets = new Map(targetList.map((t) => [t.categoryId, t]));
  const evaluated = evaluateTargets(targetList, ms, assignedFor, { today });
  const views = new Map<Id, CategoryView>();
  for (const { categories } of groups) {
    for (const c of categories) {
      const cm = ms.categories[c.id];
      if (cm) views.set(c.id, categoryView(cm, fmt, targets.get(c.id), evaluated[c.id]));
    }
  }
  const paymentIds = new Set(plan.categories.filter((c) => c.creditCardAccountId !== undefined).map((c) => c.id));
  const model: PlanModel = { plan, month, today, fmt, state, ms, groups, targets, evaluated, views, paymentIds, assignedFor };
  byKey.set(key, model);
  return model;
}
