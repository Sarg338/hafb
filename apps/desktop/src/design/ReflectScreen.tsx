// Reflect (S3.1 mockup): Spending Breakdown, Spending Trends, Net Worth, Income v Expense and
// Age of Money. Every figure comes from the engine's report functions; this file only lays them out.
import { useState, type ReactNode } from 'react';
import { ageOfMoneySeries, incomeVsExpense, netWorth, spendingBreakdown, spendingTrends, type Id, type SpendingBreakdown } from '@hafb/engine';
import { addMonths, compareMonths, formatMoney, minor, monthOf, monthParts, type ISODate, type Minor, type MoneyFormat, type Month } from '@hafb/shared';
import { prefs, usePrefs } from '../shell/prefs.ts';
import { moneyText } from '../screens/shared/money.ts';
import { budgetSnapshot, type PlanData } from '@hafb/store';
import { Icon } from '../ui/Icon.tsx';
import { donutAngles, donutSlice, linear, niceTicks } from '../screens/reflect/charts/scale.ts';
import { SeriesPatterns, Swatch, seriesFill } from '../screens/reflect/charts/Patterns.tsx';
import { moneyFormat } from '../screens/plan/planModel.ts';
import './reflect.css';

type Tab = 'breakdown' | 'trends' | 'networth' | 'income' | 'age';
type Range = 'month' | 'last3';

const TABS: { id: Tab; label: string }[] = [
  { id: 'breakdown', label: 'Spending Breakdown' },
  { id: 'trends', label: 'Spending Trends' },
  { id: 'networth', label: 'Net Worth' },
  { id: 'income', label: 'Income v Expense' },
  { id: 'age', label: 'Age of Money' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (m: Month): string => MONTHS[monthParts(m).month - 1] ?? m;
const longMonth = (m: Month): string => `${short(m)} ${String(monthParts(m).year)}`;

/** `#/design/reflect?tab=trends`: deep link for review screenshots. */
function tabFromHash(): Tab {
  const query = window.location.hash.split('?')[1] ?? '';
  const tab = new URLSearchParams(query).get('tab');
  return TABS.find((t) => t.id === tab)?.id ?? 'breakdown';
}

/** Whole-unit axis label from a tick in minor units ("$1,500"). */
function axisLabel(v: number, fmt: MoneyFormat): string {
  if (prefs.get().hideAmounts) return moneyText(fmt, true)(minor(0));
  const unit = 10 ** fmt.decimals;
  return formatMoney(minor(Math.round(v / unit)), { ...fmt, decimals: 0 });
}

const pct = (part: number, whole: number): string => (whole > 0 ? `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%` : '—');

export function ReflectScreen({ plan, today, sampleLabel = true }: { plan: PlanData; today: ISODate; /** The mockups label their synthetic data. */ sampleLabel?: boolean }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [range, setRange] = useState<Range>('last3');
  const fmt = moneyFormat(plan);
  const { hideAmounts } = usePrefs();
  const money = moneyText(fmt, hideAmounts);
  const snapshot = budgetSnapshot(plan);
  const to = monthOf(today);
  const firstMonth = plan.settings.firstMonth ?? to;
  const wantedFrom = range === 'month' ? to : addMonths(to, -2);
  const from = compareMonths(wantedFrom, firstMonth) < 0 ? firstMonth : wantedFrom;
  const rangeLabel = from === to ? longMonth(to) : `${longMonth(from)} – ${longMonth(to)}`;

  return (
    <div className="hd-main full">
      <section className="hd-work rf" aria-label="Reflect">
        <SeriesPatterns />
        <header className="rf-head">
          <h1>Reflect</h1>
          <div className="rf-tabs" role="tablist" aria-label="Reports">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`rf-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="rf-panel"
                onClick={() => {
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </header>

        <div className="rf-filters" role="toolbar" aria-label="Report filters">
          <button
            type="button"
            className="hd-chip"
            aria-label={`Date range: ${rangeLabel}. Switch to ${range === 'last3' ? 'this month' : 'the last 3 months'}`}
            onClick={() => {
              setRange(range === 'last3' ? 'month' : 'last3');
            }}
          >
            <Icon name="calendar" /> {rangeLabel} <Icon name="chevronDown" />
          </button>
          <button type="button" className="hd-chip">
            <Icon name="filter" /> All Categories
          </button>
          <button type="button" className="hd-chip">
            <Icon name="accounts" /> All Accounts
          </button>
          {sampleLabel && <span className="rf-sample muted">Sample data</span>}
        </div>

        <div className="rf-body" id="rf-panel" role="tabpanel" aria-labelledby={`rf-tab-${tab}`}>
          {tab === 'breakdown' && <Breakdown data={spendingBreakdown(snapshot, { from, to })} money={money} months={from === to ? 1 : 3} />}
          {tab === 'trends' && <Trends plan={plan} from={from} to={to} money={money} fmt={fmt} />}
          {tab === 'networth' && <NetWorth plan={plan} from={from} to={to} money={money} fmt={fmt} />}
          {tab === 'income' && <IncomeExpense plan={plan} from={from} to={to} money={money} />}
          {tab === 'age' && <AgeOfMoney plan={plan} from={from} to={to} />}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------- Spending Breakdown

function Breakdown({ data, money, months }: { data: SpendingBreakdown; money: (m: Minor) => string; months: number }) {
  const [drill, setDrill] = useState<Id | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const group = drill === null ? undefined : data.groups.find((g) => g.groupId === drill);
  const items = group
    ? group.categories.map((c) => ({ id: c.categoryId, name: c.name, amount: c.spending, drill: false }))
    : data.groups.map((g) => ({ id: g.groupId, name: g.name, amount: g.spending, drill: true }));
  const whole = group ? group.spending : data.grossSpending;
  const shown = hover === null ? undefined : items[hover];

  if (data.groups.length === 0) {
    return <Empty title="No spending yet" body="Once you spend from a category in this range, you’ll see where every dollar went." />;
  }

  const angles = donutAngles(items.map((it) => it.amount), whole);
  const slices = items.map((item, i) => {
    const [a0, a1] = angles[i] ?? [0, 0];
    return { ...item, i, d: donutSlice(130, 130, 124, 82, a0, a1) };
  });

  return (
    <div className="rf-breakdown">
      <div className="rf-donutwrap">
        <svg
          viewBox="0 0 260 260"
          className="rf-donut rf-chart"
          role="img"
          aria-label={`${group ? group.name : 'Spending by group'}: ${items.map((it) => `${it.name} ${money(it.amount)}`).join(', ')}`}
        >
          {slices.map((s) => (
            <path
              key={s.id}
              d={s.d}
              fill={seriesFill(s.i)}
              className={hover !== null && hover !== s.i ? 'dim' : undefined}
              onMouseEnter={() => {
                setHover(s.i);
              }}
              onMouseLeave={() => {
                setHover(null);
              }}
            />
          ))}
        </svg>
        <div className="rf-donutlabel" aria-hidden="true">
          <strong>{money(shown ? shown.amount : whole)}</strong>
          <span>{shown ? shown.name : group ? group.name : 'Total Spending'}</span>
        </div>
      </div>

      <div className="rf-ranked">
        <div className="rf-rankedhead">
          {group ? (
            <button
              type="button"
              className="hd-secondary"
              onClick={() => {
                setDrill(null);
                setHover(null);
              }}
            >
              <Icon name="chevronLeft" /> All groups
            </button>
          ) : (
            <h2>Spending by category group</h2>
          )}
          <div className="rf-totals">
            <div>
              <span className="muted">Total spending</span>
              <strong className="num">{money(group ? group.spending : data.total)}</strong>
            </div>
            {!group && months > 1 && (
              <div>
                <span className="muted">Average per month</span>
                <strong className="num">{money(data.averagePerMonth)}</strong>
              </div>
            )}
          </div>
        </div>
        <ol className="rf-list">
          {items.map((item, i) => (
            <li key={item.id} className={hover === i ? 'hot' : undefined} onMouseEnter={() => {
              setHover(i);
            }} onMouseLeave={() => {
              setHover(null);
            }}>
              <Swatch index={i} />
              {item.drill ? (
                <button
                  type="button"
                  className="rf-linkish"
                  onClick={() => {
                    setDrill(item.id);
                    setHover(null);
                  }}
                >
                  {item.name} <Icon name="chevronRight" />
                </button>
              ) : (
                <span>{item.name}</span>
              )}
              <span className="num">{money(item.amount)}</span>
              <span className="num muted rf-pct">{pct(item.amount, whole)}</span>
            </li>
          ))}
        </ol>
        {!group && data.inflowCategories.length > 0 && (
          <p className="rf-footnote muted">
            Not shown: {data.inflowCategories.map((c) => `${c.name} (${money(c.inflow)} more in than out)`).join(', ')}. Refunds and inflows can outweigh spending; they lower the total instead.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- Spending Trends

function Trends({ plan, from, to, money, fmt }: { plan: PlanData; from: Month; to: Month; money: (m: Minor) => string; fmt: MoneyFormat }) {
  const snapshot = budgetSnapshot(plan);
  const trends = spendingTrends(snapshot, { from, to });
  const overall = spendingBreakdown(snapshot, { from, to });
  // Per-month group totals come from the engine's breakdown for that single month.
  const perMonth = trends.months.map((m) => spendingBreakdown(snapshot, { from: m, to: m }));
  const groups = overall.groups.map((g) => ({ id: g.groupId, name: g.name }));
  const [hover, setHover] = useState<number | null>(null);

  if (groups.length === 0) return <Empty title="No spending yet" body="Spending Trends fills in as months go by." />;

  const W = 820;
  const H = 320;
  const pad = { l: 64, r: 16, t: 16, b: 34 };
  const max = Math.max(0, ...trends.totalsByMonth);
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1] ?? 1;
  const y = linear(0, top, H - pad.b, pad.t);
  const band = (W - pad.l - pad.r) / trends.months.length;
  const barW = Math.min(88, band * 0.56);
  const avgY = y(trends.averagePerMonth);
  const hovered = hover === null ? undefined : perMonth[hover];
  const hoveredMonth = hover === null ? undefined : trends.months[hover];

  return (
    <div className="rf-report">
      <div className="rf-reporthead">
        <div>
          <span className="muted">Average monthly spending</span>
          <strong className="num">{money(trends.averagePerMonth)}</strong>
        </div>
        <div>
          <span className="muted">Total spending</span>
          <strong className="num">{money(trends.total)}</strong>
        </div>
      </div>
      <div className="rf-chartbox">
        <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="rf-chart" role="img" aria-label={`Spending by month: ${trends.months.map((m, i) => `${longMonth(m)} ${money(trends.totalsByMonth[i] ?? minor(0))}`).join(', ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="rf-grid" />
              <text x={pad.l - 10} y={y(t) + 4} className="rf-axis" textAnchor="end">
                {axisLabel(t, fmt)}
              </text>
            </g>
          ))}
          {trends.months.map((m, mi) => {
            const x = pad.l + band * mi + (band - barW) / 2;
            let base = 0;
            const monthGroups = perMonth[mi]?.groups ?? [];
            return (
              <g
                key={m}
                onMouseEnter={() => {
                  setHover(mi);
                }}
                onMouseLeave={() => {
                  setHover(null);
                }}
              >
                <rect x={pad.l + band * mi} y={pad.t} width={band} height={H - pad.t - pad.b} className="rf-hit" />
                {groups.map((g, gi) => {
                  const v = Math.max(0, monthGroups.find((mg) => mg.groupId === g.id)?.spending ?? 0);
                  if (v === 0) return null;
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  return <rect key={g.id} x={x} y={y1} width={barW} height={Math.max(0, y0 - y1 - 1)} fill={seriesFill(gi)} className={hover !== null && hover !== mi ? 'dim' : undefined} />;
                })}
                <text x={pad.l + band * mi + band / 2} y={H - 10} className="rf-axis" textAnchor="middle">
                  {longMonth(m)}
                </text>
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={avgY} y2={avgY} className="rf-avg" />
        </svg>
        {hovered && hoveredMonth && hover !== null && (
          <div className="rf-tooltip hd-card" style={{ left: `${String(((pad.l + band * hover + band / 2) / W) * 100)}%` }} role="status">
            <h2>{longMonth(hoveredMonth)}</h2>
            {groups.map((g, gi) => {
              const v = hovered.groups.find((mg) => mg.groupId === g.id)?.spending;
              return v === undefined ? null : (
                <div key={g.id} className="hd-line">
                  <span>
                    <Swatch index={gi} /> {g.name}
                  </span>
                  <span className="num">{money(v)}</span>
                </div>
              );
            })}
            <div className="hd-line total">
              <span>Total</span>
              <span className="num">{money(hovered.total)}</span>
            </div>
          </div>
        )}
      </div>
      <ul className="rf-legend">
        {groups.map((g, gi) => (
          <li key={g.id}>
            <Swatch index={gi} /> {g.name}
          </li>
        ))}
        <li>
          <span className="rf-avgkey" aria-hidden="true" /> Average {money(trends.averagePerMonth)}
        </li>
      </ul>
      <table className="visually-hidden">
        <caption>Spending by group and month</caption>
        <thead>
          <tr>
            <th>Group</th>
            {trends.months.map((m) => (
              <th key={m}>{longMonth(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <th>{g.name}</th>
              {perMonth.map((pm, i) => (
                <td key={trends.months[i]}>{money(pm.groups.find((mg) => mg.groupId === g.id)?.spending ?? minor(0))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------- Net Worth

function NetWorth({ plan, from, to, money, fmt }: { plan: PlanData; from: Month; to: Month; money: (m: Minor) => string; fmt: MoneyFormat }) {
  const rows = netWorth(budgetSnapshot(plan), { from, to });
  const last = rows[rows.length - 1];
  if (!last) return <Empty title="Nothing to chart yet" body="Add an account and your net worth shows up here." />;

  const W = 820;
  const H = 340;
  const pad = { l: 84, r: 16, t: 16, b: 34 };
  const lo = Math.min(...rows.map((r) => Math.min(r.debts, r.netWorth)));
  const hi = Math.max(...rows.map((r) => Math.max(r.assets, r.netWorth)));
  const ticks = niceTicks(lo, hi);
  const y = linear(ticks[0] ?? lo, ticks[ticks.length - 1] ?? hi, H - pad.b, pad.t);
  const band = (W - pad.l - pad.r) / rows.length;
  const barW = Math.min(36, band * 0.22);
  const cx = (i: number): number => pad.l + band * i + band / 2;
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${y(r.netWorth).toFixed(1)}`).join(' ');

  return (
    <div className="rf-report">
      <div className="rf-reporthead">
        <div>
          <span className="muted">Net worth, end of {longMonth(last.month)}</span>
          <strong className="num">{money(last.netWorth)}</strong>
        </div>
        <div>
          <span className="muted">Change in {short(last.month)}</span>
          <strong className={`num${last.change > 0 ? ' rf-up' : ''}`}>
            {last.change > 0 ? '+' : ''}
            {money(last.change)}
          </strong>
        </div>
        <div>
          <span className="muted">Assets</span>
          <strong className="num">{money(last.assets)}</strong>
        </div>
        <div>
          <span className="muted">Debts</span>
          <strong className="num">{money(last.debts)}</strong>
        </div>
      </div>
      <div className="rf-chartbox">
        <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="rf-chart rf-networth" role="img" aria-label={`Net worth by month: ${rows.map((r) => `${longMonth(r.month)} ${money(r.netWorth)}`).join(', ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'rf-zero' : 'rf-grid'} />
              <text x={pad.l - 10} y={y(t) + 4} className="rf-axis" textAnchor="end">
                {axisLabel(t, fmt)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => (
            <g key={r.month}>
              <rect x={cx(i) - barW - 2} y={y(r.assets)} width={barW} height={Math.max(0, y(0) - y(r.assets))} className="rf-assets" />
              <rect x={cx(i) + 2} y={y(0)} width={barW} height={Math.max(0, y(r.debts) - y(0))} className="rf-debts" />
              <text x={cx(i)} y={H - 10} className="rf-axis" textAnchor="middle">
                {longMonth(r.month)}
              </text>
            </g>
          ))}
          <path d={line} className="rf-netline" />
          {rows.map((r, i) => (
            <circle key={r.month} cx={cx(i)} cy={y(r.netWorth)} r="4.5" className="rf-netpoint" />
          ))}
        </svg>
      </div>
      <ul className="rf-legend">
        <li>
          <span className="rf-key rf-assets" /> Assets
        </li>
        <li>
          <span className="rf-key rf-debts" /> Debts
        </li>
        <li>
          <span className="rf-key rf-netkey" /> Net worth
        </li>
      </ul>
      <table className="rf-table rf-compact">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Assets</th>
            <th className="num">Debts</th>
            <th className="num">Net worth</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <th scope="row">{longMonth(r.month)}</th>
              <td className="num">{money(r.assets)}</td>
              <td className="num">{money(r.debts)}</td>
              <td className="num">{money(r.netWorth)}</td>
              <td className="num">{money(r.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------- Income v Expense

function IncomeExpense({ plan, from, to, money }: { plan: PlanData; from: Month; to: Month; money: (m: Minor) => string }) {
  const payees = new Map(plan.payees.map((p) => [p.id, p.name]));
  const data = incomeVsExpense(budgetSnapshot(plan), { from, to }, { payeeName: (id) => (id === undefined ? 'No payee' : (payees.get(id) ?? 'Unknown payee')) });
  const [open, setOpen] = useState<ReadonlySet<Id>>(new Set());
  // Expenses are normal, not alarming: only a negative Net Income is red.
  const cell = (v: Minor, key: string, strong = false, signal = false) => (
    <td key={key} className={`num${signal && v < 0 ? ' neg' : ''}${strong ? ' strong' : ''}`}>
      {money(v)}
    </td>
  );
  const cols = (byMonth: readonly Minor[], average: Minor, total: Minor, strong = false, signal = false) => [
    ...byMonth.map((v, i) => cell(v, data.months[i] ?? String(i), strong, signal)),
    cell(average, 'avg', strong, signal),
    cell(total, 'total', strong, signal),
  ];

  return (
    <div className="rf-report">
      <div className="rf-tablewrap">
        <table className="rf-table rf-ive">
          <thead>
            <tr>
              <th scope="col">Category</th>
              {data.months.map((m) => (
                <th key={m} scope="col" className="num">
                  {longMonth(m)}
                </th>
              ))}
              <th scope="col" className="num">
                Average
              </th>
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="rf-section">
              <th scope="row" colSpan={data.months.length + 3}>
                Income
              </th>
            </tr>
            {data.income.rows.map((r) => (
              <tr key={r.payeeId ?? r.name}>
                <th scope="row" className="rf-indent">
                  {r.name}
                </th>
                {cols(r.byMonth, r.average, r.total)}
              </tr>
            ))}
            <tr className="rf-subtotal">
              <th scope="row">Total Income</th>
              {cols(data.income.totalByMonth, data.income.average, data.income.total, true)}
            </tr>

            <tr className="rf-section">
              <th scope="row" colSpan={data.months.length + 3}>
                Expenses
              </th>
            </tr>
            {data.expense.groups.map((g) => {
              const isOpen = open.has(g.groupId);
              return (
                <GroupRows key={g.groupId}>
                  <tr className="rf-group">
                    <th scope="row">
                      <button
                        type="button"
                        className="rf-linkish"
                        aria-expanded={isOpen}
                        onClick={() => {
                          setOpen((s) => {
                            const next = new Set(s);
                            if (next.has(g.groupId)) next.delete(g.groupId);
                            else next.add(g.groupId);
                            return next;
                          });
                        }}
                      >
                        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} /> {g.name}
                      </button>
                    </th>
                    {cols(g.byMonth, g.average, g.total)}
                  </tr>
                  {isOpen &&
                    g.categories.map((c) => (
                      <tr key={c.categoryId}>
                        <th scope="row" className="rf-indent2">
                          {c.name}
                        </th>
                        {cols(c.byMonth, c.average, c.total)}
                      </tr>
                    ))}
                </GroupRows>
              );
            })}
            <tr className="rf-subtotal">
              <th scope="row">Total Expenses</th>
              {cols(data.expense.totalByMonth, data.expense.average, data.expense.total, true)}
            </tr>
            <tr className="rf-net">
              <th scope="row">Net Income</th>
              {cols(data.netIncome.byMonth, data.netIncome.average, data.netIncome.total, true, true)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ---------------------------------------------------------------------------- Age of Money

function AgeOfMoney({ plan, from, to }: { plan: PlanData; from: Month; to: Month }) {
  const series = ageOfMoneySeries(budgetSnapshot(plan), from, to);
  const points = series.filter((p): p is typeof p & { ageOfMoney: number } => p.ageOfMoney !== null);
  const latest = points[points.length - 1];
  if (!latest) {
    return (
      <Empty
        title="Your Age of Money is on its way"
        body="It shows how long a dollar sits in your plan before you spend it. It needs 10 outflows from your cash accounts first; keep going and it’ll appear here."
      />
    );
  }

  const W = 820;
  const H = 300;
  const pad = { l: 56, r: 16, t: 16, b: 34 };
  const ticks = niceTicks(0, Math.max(...points.map((p) => p.ageOfMoney)) * 1.15);
  const y = linear(0, ticks[ticks.length - 1] ?? 1, H - pad.b, pad.t);
  const band = (W - pad.l - pad.r) / series.length;
  const cx = (i: number): number => pad.l + band * i + band / 2;
  const index = new Map(series.map((p, i) => [p.month, i]));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${cx(index.get(p.month) ?? 0).toFixed(1)} ${y(p.ageOfMoney).toFixed(1)}`).join(' ');

  return (
    <div className="rf-report">
      <div className="rf-reporthead">
        <div>
          <span className="muted">Age of Money, end of {longMonth(latest.month)}</span>
          <strong className="num">
            {latest.ageOfMoney} {latest.ageOfMoney === 1 ? 'day' : 'days'}
          </strong>
        </div>
        <p className="rf-explain muted">The average age of the last 10 dollars-out from your cash accounts. Older money means more breathing room.</p>
      </div>
      <div className="rf-chartbox">
        <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="rf-chart" role="img" aria-label={`Age of Money: ${points.map((p) => `${longMonth(p.month)} ${String(p.ageOfMoney)} days`).join(', ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="rf-grid" />
              <text x={pad.l - 10} y={y(t) + 4} className="rf-axis" textAnchor="end">
                {t}d
              </text>
            </g>
          ))}
          {series.map((p, i) => (
            <text key={p.month} x={cx(i)} y={H - 10} className="rf-axis" textAnchor="middle">
              {longMonth(p.month)}
            </text>
          ))}
          <path d={path} className="rf-ageline" />
          {points.map((p) => (
            <g key={p.month}>
              <circle cx={cx(index.get(p.month) ?? 0)} cy={y(p.ageOfMoney)} r="4.5" className="rf-agepoint" />
              <text x={cx(index.get(p.month) ?? 0)} y={y(p.ageOfMoney) - 12} className="rf-axis rf-pointlabel" textAnchor="middle">
                {p.ageOfMoney}d
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- empty state

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rf-empty">
      <Icon name="trending" size={20} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
