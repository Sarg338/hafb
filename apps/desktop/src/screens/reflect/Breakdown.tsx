// Spending Breakdown (S6.2, RF-03): a donut and a stack-ranked list, by category or by group
// (YNAB's Categories / Groups toggle, trial 2026-10-09), with the Positive Inflow Categories
// section (categories whose inflows beat their spending). Picking a group drills into its
// categories; picking a category lists its transactions.
import { useMemo, useState } from 'react';
import { spendingBreakdown, type Id } from '@hafb/engine';
import { budgetSnapshot } from '@hafb/store';
import { minor, type Minor } from '@hafb/shared';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { SegmentedControl } from '../../ui/SegmentedControl.tsx';
import { donutAngles, donutSlice } from './charts/scale.ts';
import { seriesFill, Swatch } from './charts/Patterns.tsx';
import { Empty, pct, rectOf, type ReportProps } from './reportKit.tsx';
import { cx as cls } from '../../ui/cx.ts';
import styles from './Reflect.module.css';

type Mode = 'categories' | 'groups';

interface Item {
  id: Id;
  name: string;
  amount: Minor;
  kind: 'category' | 'group';
  hidden: boolean;
}

export function Breakdown({ plan, filters, money, onDrill }: ReportProps) {
  const data = useMemo(() => spendingBreakdown(budgetSnapshot(plan), filters), [plan, filters]);
  const hiddenIds = useMemo(() => {
    const hiddenGroups = new Set(plan.categoryGroups.filter((g) => g.hidden === true || g.systemKind === 'hidden').map((g) => g.id));
    return new Set(plan.categories.filter((c) => c.hidden === true || hiddenGroups.has(c.groupId)).map((c) => c.id));
  }, [plan]);
  const [mode, setMode] = useState<Mode>('categories');
  const [drill, setDrill] = useState<Id | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const months = filters.from === filters.to ? 1 : 2;

  const group = mode === 'groups' && drill !== null ? data.groups.find((g) => g.groupId === drill) : undefined;
  const items: Item[] = group
    ? group.categories.map((c) => ({ id: c.categoryId, name: c.name, amount: c.spending, kind: 'category', hidden: hiddenIds.has(c.categoryId) }))
    : mode === 'groups'
      ? data.groups.map((g) => ({ id: g.groupId, name: g.name, amount: g.spending, kind: 'group', hidden: false }))
      : data.groups
          .flatMap((g) => g.categories)
          .toSorted((a, b) => b.spending - a.spending)
          .map((c) => ({ id: c.categoryId, name: c.name, amount: c.spending, kind: 'category', hidden: hiddenIds.has(c.categoryId) }));
  const whole = group ? group.spending : data.grossSpending;
  const shown = hover === null ? undefined : items[hover];

  if (data.groups.length === 0 && data.inflowCategories.length === 0) {
    return <Empty title="No spending yet" body="Once you spend from a category in this range, you’ll see where every dollar went." />;
  }

  const pick = (item: Item, el: Element): void => {
    if (item.kind === 'group') {
      setDrill(item.id);
      setHover(null);
      return;
    }
    onDrill({ kind: 'spending', select: { categoryId: item.id }, title: item.name, at: rectOf(el) });
  };
  const angles = donutAngles(
    items.map((it) => it.amount),
    whole,
  );
  const heading = group ? group.name : mode === 'groups' ? 'Spending by category group' : 'Spending by category';

  return (
    <div className={styles.breakdown}>
      <div className={styles.donutWrap}>
        <svg
          viewBox="0 0 260 260"
          className={cls(styles.chart, styles.donut)}
          role="img"
          data-chart=""
          aria-label={`${heading}: ${items.map((it) => `${it.name} ${money(it.amount)}`).join(', ')}`}
        >
          {items.map((item, i) => {
            const [a0, a1] = angles[i] ?? [0, 0];
            return (
              <path
                key={item.id}
                d={donutSlice(130, 130, 124, 82, a0, a1)}
                fill={seriesFill(i)}
                className={cls(styles.clickable, hover !== null && hover !== i && styles.dim)}
                onMouseEnter={() => {
                  setHover(i);
                }}
                onMouseLeave={() => {
                  setHover(null);
                }}
                onClick={(e) => {
                  pick(item, e.currentTarget);
                }}
              />
            );
          })}
          <text x="130" y="130" textAnchor="middle" className={styles.donutTotal}>
            {money(shown ? shown.amount : group ? group.spending : data.total)}
          </text>
          <text x="130" y="152" textAnchor="middle" className={styles.donutCaption}>
            {shown ? shown.name : group ? group.name : 'Total Spending'}
          </text>
        </svg>
      </div>

      <div className={styles.ranked}>
        <div className={styles.toolbar}>
          <SegmentedControl
            label="Show spending by"
            options={[
              { value: 'categories', label: 'Categories' },
              { value: 'groups', label: 'Groups' },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setDrill(null);
              setHover(null);
            }}
          />
        </div>
        <div className={styles.rankedHead}>
          {group ? (
            <span className={styles.crumb}>
              <Button
                size="small"
                icon="chevronLeft"
                onClick={() => {
                  setDrill(null);
                  setHover(null);
                }}
              >
                All groups
              </Button>
              <h2>{group.name}</h2>
            </span>
          ) : (
            <h2>{heading}</h2>
          )}
          <div className={styles.totals}>
            <div className={styles.stat}>
              <span>Total spending</span>
              <strong>{money(group ? group.spending : data.total)}</strong>
            </div>
            {!group && months > 1 && (
              <div className={styles.stat}>
                <span>Average per month</span>
                <strong>{money(data.averagePerMonth)}</strong>
              </div>
            )}
          </div>
        </div>
        <ol className={styles.list} aria-label={heading}>
          {items.map((item, i) => (
            <li
              key={item.id}
              className={hover === i ? styles.hot : undefined}
              onMouseEnter={() => {
                setHover(i);
              }}
              onMouseLeave={() => {
                setHover(null);
              }}
            >
              <Swatch index={i} className={styles.swatch} />
              <button
                type="button"
                className={styles.linkish}
                onClick={(e) => {
                  pick(item, e.currentTarget);
                }}
              >
                {item.name}
                {item.hidden && <Icon name="eyeOff" />}
                {item.kind === 'group' && <Icon name="chevronRight" />}
              </button>
              <span className={styles.num}>{money(item.amount)}</span>
              <span className={styles.pct}>{pct(item.amount, whole)}</span>
            </li>
          ))}
        </ol>
        {!group && data.inflowCategories.length > 0 && (
          <>
            <h2 className={styles.sectionTitle}>Positive Inflow Categories</h2>
            <ol className={styles.list} aria-label="Positive Inflow Categories">
              {data.inflowCategories.map((c) => (
                <li key={c.categoryId}>
                  <span />
                  <button
                    type="button"
                    className={styles.linkish}
                    onClick={(e) => {
                      onDrill({ kind: 'spending', select: { categoryId: c.categoryId }, title: c.name, at: rectOf(e.currentTarget) });
                    }}
                  >
                    {c.name}
                    {hiddenIds.has(c.categoryId) && <Icon name="eyeOff" />}
                  </button>
                  <span className={styles.num}>+{money(c.inflow)}</span>
                  <span />
                </li>
              ))}
            </ol>
            <p className={styles.footnote}>Inflows in these categories were more than their spending, so they lower the total instead of adding a slice.</p>
          </>
        )}
        {items.length === 0 && <p className={styles.footnote}>No spending in this range, only inflows. Total: {money(minor(data.total))}.</p>}
      </div>
    </div>
  );
}
