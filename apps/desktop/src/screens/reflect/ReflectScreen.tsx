// Reflect (S6.1–S6.3), rebuilt from the component library in the approved S3.1 look (ADR 0007):
// five report tabs over one shared filter bar (date range with previous / next, categories,
// accounts), remembered per plan file; a drill-down from any figure to its transactions; and
// export of the report's data (CSV, TSV for decimal-comma currencies) or its chart (PNG).
// Every figure comes from the engine's report functions (CLAUDE.md §10).
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { incomeLines, spendingLines, type ReportLine } from '@hafb/engine';
import type { ISODate } from '@hafb/shared';
import { budgetSnapshot, delimitedFor, exportFileName, type PlanData } from '@hafb/store';
import { errorMessage } from '../../shell/ipc.ts';
import { saveFile } from '../../shell/files.ts';
import { prefs, usePrefs, type ReflectFiltersPref } from '../../shell/prefs.ts';
import { MenuButton, type MenuItem } from '../../ui/Menu.tsx';
import { moneyFormat } from '../plan/planModel.ts';
import { moneyText } from '../shared/money.ts';
import { AgeOfMoney } from './AgeOfMoney.tsx';
import { Breakdown } from './Breakdown.tsx';
import { SeriesPatterns } from './charts/Patterns.tsx';
import { chartPng } from './chartImage.ts';
import { DrillDown } from './DrillDown.tsx';
import { IncomeExpense } from './IncomeExpense.tsx';
import { NetWorth } from './NetWorth.tsx';
import { incomeExpenseExport, netWorthExport, spendingExport } from './reflectExport.ts';
import { RangeFilter, TreeFilter } from './ReflectFilters.tsx';
import {
  accountTree,
  categoryTree,
  DEFAULT_FILTERS,
  engineFilters,
  monthsOf,
  planBounds,
  RANGE_PRESETS,
  rangeLabel,
  REPORT_TABS,
  resolveRange,
  shiftRange,
  type RangePreset,
  type ReflectFilters,
  type ReportTab,
} from './reflectModel.ts';
import { Empty, type DrillRequest, type ReportProps } from './reportKit.tsx';
import { ShareProgress } from './ShareProgress.tsx';
import { Trends } from './Trends.tsx';
import styles from './Reflect.module.css';

export interface ReflectScreenProps {
  plan: PlanData;
  /** The plan file: filters are remembered per plan (a device preference, not in the file). */
  planPath: string;
  today: ISODate;
  tab: ReportTab;
  onTab: (tab: ReportTab) => void;
  /** A drill-down row: open that transaction in its register. */
  onOpenTransaction: (accountId: string, transactionId: string) => void;
  notify: (text: string) => void;
}

const asPreset = (id: string): RangePreset => (id === 'custom' ? 'custom' : (RANGE_PRESETS.find((p) => p.id === id)?.id ?? 'thisMonth'));

function fromPref(p: ReflectFiltersPref | undefined): ReflectFilters {
  if (!p) return DEFAULT_FILTERS;
  return {
    preset: asPreset(p.preset),
    ...(p.from === undefined ? {} : { from: p.from }),
    ...(p.to === undefined ? {} : { to: p.to }),
    excludedCategories: p.excludedCategories,
    excludedAccounts: p.excludedAccounts,
  };
}

export function ReflectScreen({ plan, planPath, today, tab, onTab, onOpenTransaction, notify }: ReflectScreenProps) {
  const p = usePrefs();
  const fmt = moneyFormat(plan);
  const money = useMemo(() => moneyText(fmt, p.hideAmounts), [fmt, p.hideAmounts]);
  // The saved pref keeps its identity until it changes, so every memo below holds across renders.
  const saved = p.reflectFilters[planPath];
  const filters = useMemo(() => fromPref(saved), [saved]);
  const setFilters = (f: ReflectFilters): void => {
    prefs.update({
      reflectFilters: {
        ...prefs.get().reflectFilters,
        [planPath]: {
          preset: f.preset,
          ...(f.from === undefined ? {} : { from: f.from }),
          ...(f.to === undefined ? {} : { to: f.to }),
          excludedCategories: [...f.excludedCategories],
          excludedAccounts: [...f.excludedAccounts],
        },
      },
    });
  };
  const bounds = useMemo(() => planBounds(plan, today), [plan, today]);
  const range = useMemo(() => resolveRange(filters, today, bounds), [filters, today, bounds]);
  const scope = tab === 'networth' ? 'all' : 'budget';
  const engine = useMemo(() => engineFilters(filters, plan, range, scope), [filters, plan, range, scope]);
  const categories = useMemo(() => categoryTree(plan), [plan]);
  const accounts = useMemo(() => accountTree(plan, scope), [plan, scope]);
  const [drill, setDrill] = useState<DrillRequest | null>(null);
  const [sharing, setSharing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const label = rangeLabel(range.from, range.to);
  const tabLabel = REPORT_TABS.find((t) => t.id === tab)?.label ?? 'Reflect';

  const drillLines: ReportLine[] = useMemo(() => {
    if (!drill) return [];
    const snapshot = budgetSnapshot(plan);
    return drill.kind === 'income' ? incomeLines(snapshot, engine, drill.select) : spendingLines(snapshot, engine, drill.select);
  }, [drill, plan, engine]);

  const exportData = async (): Promise<void> => {
    const file =
      tab === 'breakdown' || tab === 'trends'
        ? spendingExport(plan, engine, tab === 'breakdown' ? 'Spending Breakdown' : 'Spending Trends', today)
        : tab === 'networth'
          ? netWorthExport(plan, engine, today)
          : incomeExpenseExport(plan, engine, (id) => (id === undefined ? 'No payee' : (plan.payees.find((x) => x.id === id)?.name ?? 'Unknown payee')), today);
    const saved = await saveFile(file.name, file.bytes);
    if (saved !== null) notify(`Exported ${tabLabel} to ${saved}.`);
  };
  const exportImage = async (): Promise<void> => {
    const svg = panel.current?.querySelector('svg[data-chart]');
    if (!(svg instanceof SVGSVGElement)) return;
    const bytes = await chartPng(svg, { title: tabLabel, subtitle: label });
    const saved = await saveFile(exportFileName([plan.settings.name, tabLabel, today], 'png'), bytes);
    if (saved !== null) notify(`Saved the ${tabLabel} chart to ${saved}.`);
  };
  const exportItems: MenuItem[] = [
    { id: 'data', label: `Export data (${delimitedFor(plan.settings).extension.toUpperCase()})…`, icon: 'export' },
    { id: 'image', label: 'Save chart as image (PNG)…', icon: 'barChart', disabled: tab === 'income' },
  ];
  const onExport = (id: string): void => {
    const run = id === 'data' ? exportData : exportImage;
    run().catch((e: unknown) => {
      notify(`Couldn’t export: ${errorMessage(e)}`);
    });
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const at = REPORT_TABS.findIndex((t) => t.id === tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? REPORT_TABS.length - 1 : step === 0 ? -1 : (at + step + REPORT_TABS.length) % REPORT_TABS.length;
    const next = REPORT_TABS[to];
    if (!next) return;
    e.preventDefault();
    onTab(next.id);
    tabRefs.current[to]?.focus();
  };

  const props: ReportProps = { plan, filters: engine, fmt, money, hidden: p.hideAmounts, onDrill: setDrill };
  const previous = shiftRange(filters, today, bounds, -1);
  const next = shiftRange(filters, today, bounds, 1);

  return (
    <section className={styles.screen} aria-label="Reflect">
      <SeriesPatterns />
      <header className={styles.head}>
        <h1>Reflect</h1>
        <div className={styles.tabs} role="tablist" aria-label="Reports" onKeyDown={onTabKey}>
          {REPORT_TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`reflect-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="reflect-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => {
                onTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.headActions}>
          {tab === 'networth' && (
            <ShareProgress plan={plan} filters={engine} today={today} open={sharing} onOpen={setSharing} notify={notify} />
          )}
          {tab !== 'age' && <MenuButton label="Export" icon="export" variant="toolbar" placement="bottom-end" items={exportItems} onSelect={onExport} />}
        </div>
      </header>

      {tab !== 'age' && (
        <div className={styles.filters} role="toolbar" aria-label="Report filters">
          <RangeFilter
            filters={filters}
            range={range}
            months={monthsOf(bounds)}
            onChange={setFilters}
            onPrevious={
              previous
                ? () => {
                    setFilters(previous);
                  }
                : null
            }
            onNext={
              next
                ? () => {
                    setFilters(next);
                  }
                : null
            }
          />
          {tab !== 'networth' && (
            <TreeFilter
              noun="Categories"
              icon="filter"
              tree={categories}
              excluded={filters.excludedCategories}
              onChange={(excludedCategories) => {
                setFilters({ ...filters, excludedCategories });
              }}
            />
          )}
          <TreeFilter
            noun="Accounts"
            icon="accounts"
            tree={accounts}
            excluded={filters.excludedAccounts}
            onChange={(excludedAccounts) => {
              setFilters({ ...filters, excludedAccounts });
            }}
          />
        </div>
      )}

      <div className={styles.body} id="reflect-panel" role="tabpanel" aria-labelledby={`reflect-tab-${tab}`} ref={panel}>
        {tab !== 'age' && range.outside ? (
          <Empty title="Nothing in this range" body={`Your plan starts in ${rangeLabel(bounds.first, bounds.first)}. Pick a later range to see this report.`} />
        ) : tab === 'breakdown' ? (
          <Breakdown {...props} />
        ) : tab === 'trends' ? (
          <Trends {...props} />
        ) : tab === 'networth' ? (
          <NetWorth {...props} />
        ) : tab === 'income' ? (
          <IncomeExpense {...props} />
        ) : (
          <AgeOfMoney plan={plan} today={today} first={bounds.first} />
        )}
      </div>

      {drill && (
        <DrillDown
          anchor={drill.at}
          title={drill.title}
          subtitle={drill.subtitle ?? label}
          lines={drillLines}
          plan={plan}
          money={money}
          onOpen={(accountId, transactionId) => {
            setDrill(null);
            onOpenTransaction(accountId, transactionId);
          }}
          onClose={() => {
            setDrill(null);
          }}
        />
      )}
    </section>
  );
}
