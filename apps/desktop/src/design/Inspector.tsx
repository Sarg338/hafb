import { useState } from 'react';
import { autoAssign, costToBeMe, limitToReadyToAssign, type AutoAssignOption, type Id } from '@hafb/engine';
import { addMonths, minor, neg, type Minor } from '@hafb/shared';
import { usePrefs } from '../shell/prefs.ts';
import { moneyText } from '../screens/shared/money.ts';
import { applyPlanChange, setAssigned, setCategoryNote } from '@hafb/store';
import { Icon } from '../ui/Icon.tsx';
import type { Actions } from './DesignApp.tsx';
import { Bar, monthName, Pill } from './PlanScreen.tsx';
import type { PlanModel } from '../screens/plan/planModel.ts';
import { targetSentence } from '../screens/plan/planView.ts';

const OPTIONS: { id: AutoAssignOption; label: string; group: number }[] = [
  { id: 'underfunded', label: 'Underfunded', group: 0 },
  { id: 'assignedLastMonth', label: 'Assigned Last Month', group: 1 },
  { id: 'spentLastMonth', label: 'Spent Last Month', group: 1 },
  { id: 'averageAssigned', label: 'Average Assigned', group: 1 },
  { id: 'averageSpent', label: 'Average Spent', group: 1 },
  { id: 'reduceOverfunding', label: 'Reduce Overfunding', group: 2 },
  { id: 'resetAvailable', label: 'Reset Available Amounts', group: 2 },
  { id: 'resetAssigned', label: 'Reset Assigned Amounts', group: 2 },
];

export function Inspector({ model, selected, actions }: { model: PlanModel; selected: ReadonlySet<Id>; actions: Actions }) {
  const { hideAmounts } = usePrefs();
  const money = moneyText(model.fmt, hideAmounts);
  const ids = [...selected].filter((id) => model.ms.categories[id] !== undefined);
  const first = ids[0];
  return (
    <aside className="hd-inspector" aria-label="Inspector">
      {ids.length === 1 && first !== undefined ? (
        <CategoryDetail key={first} model={model} id={first} actions={actions} money={money} />
      ) : (
        <>
          {ids.length > 1 ? <SelectionTotals model={model} ids={ids} money={money} /> : <MonthSummary model={model} money={money} />}
          <AutoAssign model={model} ids={ids.length > 0 ? ids : [...model.views.keys()]} actions={actions} money={money} scope={ids.length > 0 ? 'selection' : 'all'} />
          {ids.length === 0 && <CostToBeMe model={model} money={money} />}
        </>
      )}
    </aside>
  );
}

function MonthSummary({ model, money }: { model: PlanModel; money: (m: Minor) => string }) {
  const cats = Object.values(model.ms.categories);
  const leftOver = minor(cats.reduce((s, c) => s + c.carriedIn, 0));
  const prev = monthName(addMonths(model.month, -1)).slice(0, 3);
  return (
    <section className="hd-card">
      <h2>{monthName(model.month)}’s Summary</h2>
      <div className="hd-line">
        <span>Left over from {prev}</span>
        <span className="num">{money(leftOver)}</span>
      </div>
      <div className="hd-line">
        <span>Assigned in {monthName(model.month).slice(0, 3)}</span>
        <span className="num">{money(model.ms.totals.assigned)}</span>
      </div>
      <div className="hd-line">
        <span>Activity</span>
        <span className="num">{money(model.ms.totals.activity)}</span>
      </div>
      <div className="hd-line total">
        <span>Available</span>
        <span className="num">{money(model.ms.totals.available)}</span>
      </div>
    </section>
  );
}

function SelectionTotals({ model, ids, money }: { model: PlanModel; ids: Id[]; money: (m: Minor) => string }) {
  const sum = (pick: (id: Id) => number): Minor => minor(ids.reduce((s, id) => s + pick(id), 0));
  return (
    <section className="hd-card">
      <h2>{ids.length} categories selected</h2>
      <div className="hd-line">
        <span>Assigned</span>
        <span className="num">{money(sum((id) => model.ms.categories[id]?.assigned ?? 0))}</span>
      </div>
      <div className="hd-line">
        <span>Activity</span>
        <span className="num">{money(sum((id) => model.ms.categories[id]?.activity ?? 0))}</span>
      </div>
      <div className="hd-line total">
        <span>Available</span>
        <span className="num">{money(sum((id) => model.ms.categories[id]?.available ?? 0))}</span>
      </div>
    </section>
  );
}

function AutoAssign({
  model,
  ids,
  actions,
  money,
  scope,
}: {
  model: PlanModel;
  ids: Id[];
  actions: Actions;
  money: (m: Minor) => string;
  scope: 'all' | 'selection';
}) {
  const [open, setOpen] = useState(true);
  const input = {
    state: model.state,
    month: model.month,
    categoryIds: ids,
    targets: [...model.targets.values()],
    evaluated: model.evaluated,
    paymentCategoryIds: model.paymentIds,
  };
  const options = OPTIONS.filter((o) => scope === 'selection' || (o.id !== 'resetAvailable' && o.id !== 'resetAssigned')).map((o) => {
    const change = autoAssign(o.id, input);
    return { ...o, change };
  });
  return (
    <section className="hd-card">
      <h2>
        <button type="button" className="hd-iconbtn" style={{ width: 22, height: 22, marginLeft: -4 }} aria-expanded={open} aria-label={open ? 'Collapse Auto-Assign' : 'Expand Auto-Assign'} onClick={() => {
          setOpen(!open);
        }}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        </button>
        Auto-Assign
      </h2>
      {open &&
        options.map((o, i) => (
          <div key={o.id}>
            {i > 0 && options[i - 1]?.group !== o.group && <div className="hd-autosep" />}
            <button
              type="button"
              className="hd-autobtn"
              disabled={o.change.deltas.length === 0}
              onClick={() => {
                const change = o.id === 'underfunded' ? limitToReadyToAssign(o.change, model.ms.readyToAssign) : o.change;
                actions.run((p, ctx) => applyPlanChange(p, ctx, { change, kind: 'autoAssign', label: `Auto-Assign: ${o.label}` }));
              }}
            >
              <span>{o.label}</span>
              <span className="num">{money(o.change.total)}</span>
            </button>
          </div>
        ))}
    </section>
  );
}

function CostToBeMe({ model, money }: { model: PlanModel; money: (m: Minor) => string }) {
  const income = model.plan.settings.expectedIncome ?? minor(0);
  const cost = costToBeMe(model.evaluated, income);
  const pct = income > 0 ? Math.min(100, (cost.targets / income) * 100) : 0;
  return (
    <section className="hd-card">
      <h2>
        <Icon name="target" /> Cost to Be Me
      </h2>
      <div className="hd-big stack">
        <strong>{money(cost.targets)}</strong>
        <span className="muted">of {money(income)} expected income</span>
      </div>
      <div className={`hd-meter${cost.difference < 0 ? ' short' : ''}`} role="img" aria-label={`Targets use ${String(Math.round(pct))}% of expected income`}>
        <span style={{ transform: `scaleX(${String(pct / 100)})` }} />
      </div>
      <p className="hd-note">
        {cost.difference >= 0
          ? `${money(cost.difference)} left over each month after your targets. Nice cushion.`
          : `Your targets need ${money(neg(cost.difference))} more than you expect to earn.`}
      </p>
    </section>
  );
}

function CategoryDetail({ model, id, actions, money }: { model: PlanModel; id: Id; actions: Actions; money: (m: Minor) => string }) {
  const cm = model.ms.categories[id];
  const view = model.views.get(id);
  const category = model.plan.categories.find((c) => c.id === id);
  const target = model.targets.get(id);
  const tm = model.evaluated[id];
  const [note, setNote] = useState(category?.note ?? '');
  if (!cm || !view || !category) return null;
  const prev = monthName(addMonths(model.month, -1)).slice(0, 3);
  return (
    <>
      <section className="hd-card">
        <h2>{category.name}</h2>
        <div className="hd-big">
          <span className="muted">Available</span>
          <Pill view={view} value={cm.available} money={money} />
        </div>
        <div className="hd-line">
          <span>Cash left over from {prev}</span>
          <span className="num">{money(cm.carriedIn)}</span>
        </div>
        <div className="hd-line">
          <span>Assigned this month</span>
          <span className="num">{money(cm.assigned)}</span>
        </div>
        <div className="hd-line">
          <span>Cash spending</span>
          <span className="num">{money(cm.cashActivity)}</span>
        </div>
        <div className="hd-line">
          <span>Credit spending</span>
          <span className="num">{money(cm.creditActivity)}</span>
        </div>
        <div className="hd-line total">
          <span>Available</span>
          <span className="num">{money(cm.available)}</span>
        </div>
        {view.state === 'overspent' && (
          <p className="hd-note">
            {view.credit
              ? 'You spent more than you had on a credit card. Cover it now, or the card balance grows past what’s set aside to pay it.'
              : 'Cash overspending comes out of next month’s Ready to Assign unless you cover it.'}
          </p>
        )}
      </section>

      <section className="hd-card">
        <h2>
          <Icon name="target" /> Target
        </h2>
        {target && tm ? (
          <>
            <p style={{ margin: '0 0 8px' }}>{targetSentence(target, tm, model.fmt)}</p>
            {view.bar && <Bar bar={view.bar} state={view.barState} />}
            <div className="hd-line" style={{ marginTop: 8 }}>
              <span>Funded</span>
              <span className="num">
                {money(tm.funded < tm.needed ? tm.funded : tm.needed)} of {money(tm.needed)}
              </span>
            </div>
            <div className="hd-line">
              <span>To go this month</span>
              <span className="num">{money(tm.underfunded)}</span>
            </div>
            <div className="hd-cardactions">
              {cm.available < 0 ? (
                <button
                  type="button"
                  className="hd-primary"
                  onClick={() => {
                    actions.run((p, ctx) => setAssigned(p, ctx, { month: model.month, categoryId: id, amount: minor(cm.assigned - cm.available) }));
                  }}
                >
                  Cover {money(neg(cm.available))}
                </button>
              ) : (
                <button
                  type="button"
                  className="hd-primary"
                  disabled={tm.underfunded <= 0}
                  onClick={() => {
                    actions.run((p, ctx) => setAssigned(p, ctx, { month: model.month, categoryId: id, amount: minor(cm.assigned + tm.underfunded) }));
                  }}
                >
                  {tm.underfunded > 0 ? `Assign ${money(tm.underfunded)}` : 'Fully funded'}
                </button>
              )}
              <button type="button" className="hd-secondary">
                <Icon name="edit" /> Edit Target
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hd-note">How much does {category.name} need? A target tells you what to assign each month.</p>
            <div className="hd-cardactions">
              <button type="button" className="hd-secondary">
                <Icon name="add" /> Create Target
              </button>
            </div>
          </>
        )}
      </section>

      <AutoAssign model={model} ids={[id]} actions={actions} money={money} scope="selection" />

      <section className="hd-card">
        <h2>
          <Icon name="note" /> Notes
        </h2>
        <textarea
          className="hd-textarea"
          aria-label={`Note for ${category.name}`}
          placeholder="Enter a note…"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          onBlur={() => {
            if (note !== (category.note ?? '')) actions.run((p, ctx) => setCategoryNote(p, ctx, { categoryId: id, note }));
          }}
        />
      </section>
    </>
  );
}
