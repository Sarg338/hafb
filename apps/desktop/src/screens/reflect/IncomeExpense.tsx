// Income v Expense (S6.3, RF-06), laid out as YNAB does (trial 2026-10-09): Income (All Income
// Sources by payee, Total Income), Expense (each group with its categories and a group total,
// Total Expenses), then Net Income, green when positive and red when negative. Sections and
// groups collapse; any amount opens its transactions (YNAB help, Income v Expense).
import { useMemo, useState, type ReactNode } from 'react';
import { incomeVsExpense, type LineSelector } from '@hafb/engine';
import type { Minor, Month } from '@hafb/shared';
import { budgetSnapshot } from '@hafb/store';
import { Icon } from '../../ui/Icon.tsx';
import { monthLabel, rangeLabel } from './reflectModel.ts';
import { Empty, rectOf, type ReportProps } from './reportKit.tsx';
import { cx as cls } from '../../ui/cx.ts';
import styles from './Reflect.module.css';

interface Figures {
  byMonth: readonly Minor[];
  average: Minor;
  total: Minor;
}

export function IncomeExpense({ plan, filters, money, onDrill }: ReportProps) {
  const payees = useMemo(() => new Map(plan.payees.map((p) => [p.id, p.name])), [plan]);
  const data = useMemo(
    () => incomeVsExpense(budgetSnapshot(plan), filters, { payeeName: (id) => (id === undefined ? 'No payee' : (payees.get(id) ?? 'Unknown payee')) }),
    [plan, filters, payees],
  );
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => {
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isOpen = (id: string) => !closed.has(id);

  if (data.income.rows.length === 0 && data.expense.groups.length === 0) {
    return <Empty title="Nothing in or out yet" body="Income and spending in your cash and credit accounts show up here, month by month." />;
  }

  const span = data.months.length + 3;
  const whole = rangeLabel(filters.from, filters.to);
  /** Month cells, Average and Total; each amount opens the lines behind it. */
  const cells = (f: Figures, kind: 'spending' | 'income', select: LineSelector, title: string, opts: { strong?: boolean; signal?: boolean; drill?: boolean } = {}): ReactNode[] => {
    const cell = (v: Minor, key: string, month: Month | null, drill: boolean) => (
      <td key={key} className={cls(styles.num, opts.strong === true && styles.strong, opts.signal === true && v < 0 && styles.neg, opts.signal === true && v > 0 && styles.pos)}>
        {drill && opts.drill !== false && v !== 0 ? (
          <button
            type="button"
            className={styles.cellButton}
            aria-label={`${title}, ${month === null ? whole : monthLabel(month)}: ${money(v)}`}
            onClick={(e) => {
              onDrill({ kind, select: month === null ? select : { ...select, month }, title, subtitle: month === null ? whole : monthLabel(month), at: rectOf(e.currentTarget) });
            }}
          >
            {money(v)}
          </button>
        ) : (
          money(v)
        )}
      </td>
    );
    return [...f.byMonth.map((v, i) => cell(v, data.months[i] ?? String(i), data.months[i] ?? null, true)), cell(f.average, 'avg', null, false), cell(f.total, 'total', null, true)];
  };
  const toggleRow = (id: string, label: string, className: string, figures?: ReactNode[]) => (
    <tr className={className}>
      <th scope="row" colSpan={figures ? 1 : span}>
        <button type="button" className={styles.linkish} aria-expanded={isOpen(id)} onClick={() => { toggle(id); }}>
          <Icon name={isOpen(id) ? 'chevronDown' : 'chevronRight'} /> {label}
        </button>
      </th>
      {figures}
    </tr>
  );
  const income: Figures = { byMonth: data.income.totalByMonth, average: data.income.average, total: data.income.total };

  return (
    <div className={styles.report}>
      <div className={styles.tableWrap}>
        <table className={cls(styles.table, styles.ive)}>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Category</span>
              </th>
              {data.months.map((m) => (
                <th key={m} scope="col" className={styles.num}>
                  {monthLabel(m)}
                </th>
              ))}
              <th scope="col" className={styles.num}>
                Average
              </th>
              <th scope="col" className={styles.num}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {toggleRow('income', 'Income', styles.section ?? '')}
            {isOpen('income') && (
              <>
                {isOpen('sources')
                  ? toggleRow('sources', 'All Income Sources', styles.group ?? '')
                  : toggleRow('sources', 'All Income Sources', styles.group ?? '', cells(income, 'income', {}, 'All Income Sources'))}
                {isOpen('sources') &&
                  data.income.rows.map((r) => (
                    <tr key={r.payeeId ?? r.name}>
                      <th scope="row" className={styles.indent}>
                        {r.name}
                      </th>
                      {cells(r, 'income', { payeeId: r.payeeId }, r.name)}
                    </tr>
                  ))}
                {isOpen('sources') && (
                  <tr className={styles.subtotal}>
                    <th scope="row">Total All Income Sources</th>
                    {cells(income, 'income', {}, 'All Income Sources', { strong: true })}
                  </tr>
                )}
              </>
            )}
            <tr className={styles.subtotal}>
              <th scope="row">Total Income</th>
              {cells(income, 'income', {}, 'Income', { strong: true })}
            </tr>

            {toggleRow('expense', 'Expense', styles.section ?? '')}
            {isOpen('expense') &&
              data.expense.groups.map((g) => (
                <Rows key={g.groupId}>
                  {isOpen(`g:${g.groupId}`)
                    ? toggleRow(`g:${g.groupId}`, g.name, styles.group ?? '')
                    : toggleRow(`g:${g.groupId}`, g.name, styles.group ?? '', cells(g, 'spending', { groupId: g.groupId }, g.name))}
                  {isOpen(`g:${g.groupId}`) &&
                    g.categories.map((c) => (
                      <tr key={c.categoryId}>
                        <th scope="row" className={styles.indent2}>
                          {c.name}
                        </th>
                        {cells(c, 'spending', { categoryId: c.categoryId }, c.name)}
                      </tr>
                    ))}
                  {isOpen(`g:${g.groupId}`) && (
                    <tr>
                      <th scope="row" className={styles.indent}>
                        Total {g.name}
                      </th>
                      {cells(g, 'spending', { groupId: g.groupId }, g.name, { strong: true })}
                    </tr>
                  )}
                </Rows>
              ))}
            <tr className={styles.subtotal}>
              <th scope="row">Total Expenses</th>
              {cells({ byMonth: data.expense.totalByMonth, average: data.expense.average, total: data.expense.total }, 'spending', {}, 'Expenses', { strong: true })}
            </tr>
            <tr className={styles.net}>
              <th scope="row">Net Income</th>
              {/* Net income mixes income and spending: its cells show the figure only. */}
              {cells(data.netIncome, 'spending', {}, 'Net Income', { strong: true, signal: true, drill: false })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
