// The Plan inspector (S5.1), production version of the S3.1 mockup's (ADR 0007), laid out like YNAB's
// (trial, 2026-10-08):
// - Nothing selected: "[Month]'s Summary" with Cost to Be Me inside it, Auto-Assign, Assigned in
//   Future Months.
// - Several selected: "N Categories Selected" with their names, their summary, Auto-Assign for them.
// - One selected: its name, "Available Balance" (with upcoming scheduled transactions and Available
//   After Upcoming), Target, Auto-Assign, Notes. A payment category shows Available for Payment and
//   the card's Current Balance instead.
// Every section collapses, and the choice is remembered on this PC.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { limitToReadyToAssign, type Id } from '@hafb/engine';
import { minor, monthParts, neg, ZERO, type Minor, type Month } from '@hafb/shared';
import { applyPlanChange, setAssigned, setCategoryNote, setExpectedIncome } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { prefs, usePrefs } from '../../shell/prefs.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { ProgressBar } from '../../ui/ProgressBar.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { cardBalance } from '../shared/cardModel.ts';
import type { MoneyText } from '../shared/money.ts';
import { autoAssignChoices, costView, monthSummary, type FutureMonth } from './inspectorModel.ts';
import { monthName } from './PlanHeader.tsx';
import type { PlanModel } from './planModel.ts';
import { targetSentence } from './planView.ts';
import styles from './Inspector.module.css';

export interface InspectorProps {
  model: PlanModel;
  selected: ReadonlySet<Id>;
  actions: Actions;
  money: MoneyText;
  future: readonly FutureMonth[];
  /** Later months whose Ready to Assign is negative (YNAB warns in Assigned in Future Months). */
  shortfalls: readonly { month: Month; readyToAssign: Minor }[];
  /** Rename the selected category (the pencil beside its name). */
  onRename?: (id: Id, anchor: Element) => void;
  /** Create or edit a category's target (S5.2). */
  onTarget?: (id: Id) => void;
  className?: string;
  edge?: ReactNode;
}

export function Inspector({ model, selected, actions, money, future, shortfalls, onRename, onTarget, className, edge }: InspectorProps) {
  const ids = [...selected].filter((id) => model.ms.categories[id] !== undefined);
  const first = ids[0];
  return (
    <aside className={cx(styles.inspector, className)} aria-label="Inspector">
      {edge}
      {ids.length === 1 && first !== undefined ? (
        <CategoryDetail key={first} model={model} id={first} actions={actions} money={money} onRename={onRename} onTarget={onTarget} />
      ) : ids.length > 1 ? (
        <>
          <header className={styles.selectionHead}>
            <h2 className={styles.title}>{ids.length} Categories Selected</h2>
            <p className={styles.names}>{ids.map((id) => model.plan.categories.find((c) => c.id === id)?.name ?? '').join(', ')}</p>
          </header>
          <SummaryCard model={model} money={money} ids={ids} actions={actions} withCost={false} />
          <AutoAssign model={model} ids={ids} selection actions={actions} money={money} />
        </>
      ) : (
        <>
          <SummaryCard model={model} money={money} actions={actions} withCost />
          <AutoAssign model={model} ids={[...model.views.keys()]} selection={false} actions={actions} money={money} />
          <FutureCard future={future} shortfalls={shortfalls} money={money} />
        </>
      )}
    </aside>
  );
}

/** A card whose header collapses it; the open/closed choice is kept in prefs. */
function Section({ id, title, aside, children }: { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const { inspectorCollapsed } = usePrefs();
  const open = !inspectorCollapsed.includes(id);
  const toggle = (): void => {
    const now = prefs.get().inspectorCollapsed;
    prefs.update({ inspectorCollapsed: open ? [...now, id] : now.filter((x) => x !== id) });
  };
  return (
    <section className={styles.card} data-section={id}>
      <h3 className={styles.cardHead}>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>
          {title}
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        </button>
        {aside !== undefined && <span className={styles.cardAside}>{aside}</span>}
      </h3>
      {open && <div className={styles.cardBody}>{children}</div>}
    </section>
  );
}

function Line({ label, value, total = false }: { label: ReactNode; value: string; total?: boolean }) {
  return (
    <div className={cx(styles.line, total && styles.total)}>
      <span>{label}</span>
      <span className={styles.num}>{value}</span>
    </div>
  );
}

function SummaryCard({ model, money, ids, actions, withCost }: { model: PlanModel; money: MoneyText; ids?: Id[]; actions: Actions; withCost: boolean }) {
  const s = monthSummary(model.ms, ids);
  const name = monthName(model.month);
  return (
    <Section id="summary" title={`${name}’s Summary`}>
      <Line label="Left Over from Last Month" value={money(s.leftOver)} />
      <Line label={`Assigned in ${name}`} value={money(s.assigned)} />
      <Line label="Activity" value={money(s.activity)} />
      <Line label="Available" value={money(s.available)} total />
      {withCost && <CostToBeMe model={model} money={money} actions={actions} />}
    </Section>
  );
}

/** Cost to Be Me (YNAB): this month's targets against expected income, which edits in place. */
function CostToBeMe({ model, money, actions }: { model: PlanModel; money: MoneyText; actions: Actions }) {
  const cost = costView(model);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Minor>(cost.income);
  const incomeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) incomeRef.current?.focus();
  }, [editing]);
  const save = (): void => {
    setEditing(false);
    if (draft !== cost.income) actions.run((p, ctx) => setExpectedIncome(p, ctx, { amount: draft }));
  };
  return (
    <div className={styles.cost}>
      <h4 className={styles.subhead}>Cost to Be Me</h4>
      <Line label={`${monthName(model.month)}’s Targets`} value={money(cost.targets)} />
      {(cost.income > 0 || editing) && <Meter percent={cost.targetsPercent} tone={cost.difference < 0 ? 'short' : 'accent'} />}
      {editing ? (
        <div className={styles.incomeEdit}>
          <MoneyInput
            ref={incomeRef}
            label="Expected Income"
            variant="field"
            value={draft}
            format={model.fmt}
            onCommit={(v) => {
              setDraft(v);
            }}
            onEnter={save}
          />
          <div className={styles.actions}>
            <Button
              variant="toolbar"
              onClick={() => {
                setEditing(false);
                setDraft(cost.income);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : cost.income > 0 ? (
        <>
          <div className={styles.line}>
            <span>Expected Income</span>
            <span className={styles.num}>
              {money(cost.income)}
              <IconButton
                icon="edit"
                size="small"
                label="Edit expected income"
                onClick={() => {
                  setDraft(cost.income);
                  setEditing(true);
                }}
              />
            </span>
          </div>
          <Meter percent={cost.incomePercent} tone="track" />
          <p className={styles.note}>
            {cost.difference >= 0 ? `${money(cost.difference)} left over each month after your targets.` : `Your targets need ${money(neg(cost.difference))} more than you expect to earn.`}
          </p>
        </>
      ) : (
        <Button
          variant="secondary"
          full
          onClick={() => {
            setDraft(ZERO);
            setEditing(true);
          }}
        >
          Enter your expected income
        </Button>
      )}
    </div>
  );
}

/** The pie's fill as a CSS custom property (React's style type has no custom properties). */
function pieStyle(funded: number | null): Record<string, string> {
  return { '--pie': String(Math.round((funded ?? 0) * 100)) };
}

function Meter({ percent, tone }: { percent: number; tone: 'accent' | 'short' | 'track' }) {
  return (
    <div className={styles.meter} data-tone={tone} aria-hidden="true">
      <span style={{ transform: `scaleX(${String(Math.max(0, Math.min(100, percent)) / 100)})` }} />
    </div>
  );
}

function AutoAssign({ model, ids, selection, actions, money }: { model: PlanModel; ids: Id[]; selection: boolean; actions: Actions; money: MoneyText }) {
  const choices = autoAssignChoices(model, ids, selection);
  return (
    <Section id="autoAssign" title={<><Icon name="sync" /> Auto-Assign</>}>
      {choices.map((o, i) => (
        <div key={o.id}>
          {i > 0 && choices[i - 1]?.group !== o.group && <div className={styles.sep} />}
          <button
            type="button"
            className={styles.auto}
            disabled={o.change.deltas.length === 0}
            onClick={() => {
              // Underfunded shows the full need but stops when Ready to Assign runs out (YNAB trial).
              const change = o.id === 'underfunded' ? limitToReadyToAssign(o.change, model.ms.readyToAssign) : o.change;
              actions.run((p, ctx) => applyPlanChange(p, ctx, { change, kind: 'autoAssign', label: `Auto-Assign: ${o.label}` }));
            }}
          >
            <span>{o.label}</span>
            <span className={styles.num}>{money(o.change.total)}</span>
          </button>
        </div>
      ))}
    </Section>
  );
}

function FutureCard({ future, shortfalls, money }: { future: readonly FutureMonth[]; shortfalls: readonly { month: Month; readyToAssign: Minor }[]; money: MoneyText }) {
  const total = minor(future.reduce((s, m) => s + m.assigned, 0));
  const firstYear = monthParts(future[0]?.month ?? '2000-01').year;
  return (
    <Section
      id="future"
      title={
        <>
          {shortfalls.length > 0 && <Icon name="warning" className={styles.warn} />}
          Assigned in Future Months
        </>
      }
      aside={money(total)}
    >
      {future.map((m) => (
        <div className={styles.futureLine} key={m.month}>
          <span
            className={styles.pie}
            data-full={m.funded !== null && m.funded >= 1 ? '' : undefined}
            style={pieStyle(m.funded)}
            role="img"
            aria-label={m.funded === null ? 'No targets due' : `${String(Math.round(m.funded * 100))}% of targets funded`}
          />
          <span>{monthParts(m.month).year === firstYear ? monthName(m.month) : `${monthName(m.month)} ${String(monthParts(m.month).year)}`}</span>
          <span className={styles.num}>{money(m.assigned)}</span>
        </div>
      ))}
      {shortfalls.map((s) => (
        <p className={cx(styles.note, styles.warnNote)} key={s.month}>
          {monthName(s.month)} is {money(neg(s.readyToAssign))} short: more is assigned there than you’ll have. Move some back, or wait for more income.
        </p>
      ))}
    </Section>
  );
}

function CategoryDetail({ model, id, actions, money, onRename, onTarget }: { model: PlanModel; id: Id; actions: Actions; money: MoneyText; onRename: InspectorProps['onRename']; onTarget: InspectorProps['onTarget'] }) {
  const cm = model.ms.categories[id];
  const view = model.views.get(id);
  const category = model.plan.categories.find((c) => c.id === id);
  const target = model.targets.get(id);
  const tm = model.evaluated[id];
  const [note, setNote] = useState(category?.note ?? '');
  if (!cm || !view || !category) return null;
  const balance = cardBalance(cm);
  const upcoming = model.upcoming[id];
  const payment = cm.creditCard !== undefined;
  return (
    <>
      <header className={styles.categoryHead}>
        <h2 className={styles.title}>{category.name}</h2>
        {onRename && !payment && (
          <IconButton
            icon="edit"
            size="small"
            label={`Rename ${category.name}`}
            onClick={(e) => {
              onRename(id, e.currentTarget);
            }}
          />
        )}
      </header>
      <Section
        id="balance"
        title={payment ? 'Available for Payment' : 'Available Balance'}
        aside={
          <Pill state={view.state} credit={view.credit} upcoming={view.upcoming === true} {...(view.message ? { title: view.message } : {})}>
            {money(cm.available)}
          </Pill>
        }
      >
        {payment && cm.creditCard ? (
          <>
            {view.state === 'underfunded' && view.message && <p className={cx(styles.note, styles.warnNote)}>{view.message} in order to pay off the current balance.</p>}
            <Line label="Cash Left Over From Last Month" value={money(cm.carriedIn)} />
            <Line label="Assigned" value={money(cm.assigned)} />
            <Line label="Funded Spending" value={money(cm.creditCard.fundedSpending)} />
            <Line label="Payments Made" value={money(neg(cm.creditCard.payments))} />
            <Line label="Available for Payment" value={money(cm.available)} total />
            {balance && (
              <div className={styles.group}>
                <Line label="Prior Balance" value={money(balance.prior)} />
                <Line label="Spending and Outflows" value={money(balance.spending)} />
                <Line label="Payments and Inflows" value={money(balance.inflows)} />
                <Line label="Current Balance" value={money(balance.current)} total />
              </div>
            )}
          </>
        ) : (
          <>
            <Line label="Cash Left Over From Last Month" value={money(cm.carriedIn)} />
            <Line label="Assigned This Month" value={money(cm.assigned)} />
            <Line label="Cash Spending" value={money(cm.cashActivity)} />
            <Line label="Credit Spending" value={money(cm.creditActivity)} />
          </>
        )}
        {upcoming && (
          // YNAB's yellow box: what scheduled transactions still due this month will do.
          <div className={cx(styles.upcoming, cm.available + upcoming.amount < 0 && styles.upcomingShort)}>
            <div className={styles.line}>
              <span>
                <Icon name="calendar" /> {upcoming.count} Upcoming Transaction{upcoming.count === 1 ? '' : 's'}
              </span>
              <span className={styles.num}>{money(upcoming.amount)}</span>
            </div>
            <div className={styles.line}>
              <span>Available After Upcoming</span>
              <span className={styles.num}>{money(minor(cm.available + upcoming.amount))}</span>
            </div>
          </div>
        )}
        {view.state === 'overspent' && (
          <p className={styles.note}>
            {view.credit ? 'You spent more than you had on a credit card. Cover it now, or the card balance grows past what’s set aside to pay it.' : 'Cash overspending comes out of next month’s Ready to Assign unless you cover it.'}
          </p>
        )}
      </Section>

      {!payment && (
        <Section id="target" title={<><Icon name="target" /> Target</>}>
          {target && tm ? (
            <>
              <p className={styles.sentence}>{targetSentence(target, tm, model.fmt)}</p>
              {view.bar && <ProgressBar {...view.bar} state={view.barState} label={`${String(Math.round(view.bar.fillPercent))}% funded`} />}
              <Line label="Funded" value={`${money(minor(Math.min(tm.funded, tm.needed)))} of ${money(tm.needed)}`} />
              <Line label="To Go This Month" value={money(tm.underfunded)} />
              <div className={styles.actions}>
                {cm.available < 0 ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      actions.run((p, ctx) => setAssigned(p, ctx, { month: model.month, categoryId: id, amount: minor(cm.assigned - cm.available) }));
                    }}
                  >
                    Cover {money(neg(cm.available))}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={tm.underfunded <= 0}
                    onClick={() => {
                      actions.run((p, ctx) => setAssigned(p, ctx, { month: model.month, categoryId: id, amount: minor(cm.assigned + tm.underfunded) }));
                    }}
                  >
                    {tm.underfunded > 0 ? `Assign ${money(tm.underfunded)}` : 'Fully Funded'}
                  </Button>
                )}
                {onTarget && (
                  <Button variant="secondary" icon="edit" onClick={() => { onTarget(id); }}>
                    Edit Target
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className={styles.sentence}>
                <strong>How much do you need for {category.name}?</strong>
              </p>
              <p className={styles.note}>When you create a target, you’ll see how much money to set aside to stay on track over time.</p>
              {onTarget && (
                <div className={styles.actions}>
                  <Button variant="secondary" icon="add" onClick={() => { onTarget(id); }}>
                    Create Target
                  </Button>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      <AutoAssign model={model} ids={[id]} selection actions={actions} money={money} />

      <Section id="notes" title={<><Icon name="note" /> Notes</>}>
        <TextArea
          label={`Note for ${category.name}`}
          hideLabel
          placeholder="Enter a note…"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          onBlur={() => {
            if (note !== (category.note ?? '')) actions.run((p, ctx) => setCategoryNote(p, ctx, { categoryId: id, note }));
          }}
        />
      </Section>
    </>
  );
}
