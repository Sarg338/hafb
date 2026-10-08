import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Id } from '@hafb/engine';
import { addMonths, formatMoney, minor, monthParts, parseDecimal, ZERO, type ISODate, type Minor, type Month } from '@hafb/shared';
import { setAssigned, setMonthNote, type PlanData } from '@hafb/store';
import { Icon } from '../ui/Icon.tsx';
import type { Actions } from './DesignApp.tsx';
import { Inspector } from './Inspector.tsx';
import { planModel, type PlanModel } from './planModel.ts';
import type { BarView, CategoryView } from './planView.ts';

type ViewFilter = 'all' | 'underfunded' | 'overfunded' | 'available' | 'snoozed' | 'overspent';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: Month): string => MONTH_NAMES[monthParts(m).month - 1] ?? m;
export const monthShort = (m: Month): string => `${monthName(m).slice(0, 3)} ${String(monthParts(m).year)}`;

/** Animate an integer toward its new value: the signature "cause and effect" motion (180 ms ease-out). */
function useTweened(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const from = shownRef.current;
    if (from === value || reduced) {
      shownRef.current = value;
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (t: number): void => {
      const k = Math.min(1, (t - start) / 180);
      const v = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Frames don't run in hidden or minimised windows: always land on the true value.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      shownRef.current = value;
      setShown(value);
    }, 220);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [value, reduced]);
  return reduced ? value : shown;
}

function matches(filter: ViewFilter, model: PlanModel, id: Id): boolean {
  const view = model.views.get(id);
  const cm = model.ms.categories[id];
  if (!view || !cm) return false;
  switch (filter) {
    case 'all':
      return true;
    case 'underfunded':
      return view.state === 'underfunded';
    case 'overfunded':
      return (model.evaluated[id]?.overfunded ?? 0) > 0;
    case 'available':
      return cm.available > 0;
    case 'snoozed':
      return view.state === 'snoozed';
    case 'overspent':
      return cm.available < 0;
  }
}

export function PlanScreen({
  plan,
  today,
  month,
  setMonth,
  initialSelect,
  demoAssign,
  actions,
  history,
}: {
  plan: PlanData;
  today: ISODate;
  month: Month;
  setMonth: (m: Month) => void;
  /** Deep link: select a category by name on open (review screenshots). */
  initialSelect?: string | null;
  /** Deep link `Category:dollars`: assign once after opening (before/after review captures). */
  demoAssign?: string | null;
  actions: Actions;
  history: { canUndo: boolean; canRedo: boolean; undoLabel: string | undefined; redoLabel: string | undefined };
}) {
  const model = planModel(plan, month, today);
  const money = (m: Minor): string => formatMoney(m, model.fmt);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<Id>>(() => {
    const hit = initialSelect ? plan.categories.find((c) => c.name === initialSelect) : undefined;
    return new Set(hit ? [hit.id] : []);
  });
  const [collapsed, setCollapsed] = useState<ReadonlySet<Id>>(() => new Set(plan.categoryGroups.filter((g) => g.systemKind === 'hidden').map((g) => g.id)));
  const demoDone = useRef(false);
  useEffect(() => {
    if (demoDone.current || !demoAssign) return;
    demoDone.current = true;
    const [name, dollars] = demoAssign.split(':');
    const category = plan.categories.find((c) => c.name === name);
    if (!category || dollars === undefined) return;
    const timer = window.setTimeout(() => {
      actions.run((p, ctx) => setAssigned(p, ctx, { month, categoryId: category.id, amount: parseDecimal(dollars, model.fmt.decimals) }));
    }, 600);
    return () => {
      // React's dev double-invoke runs this cleanup once; let the second run schedule again.
      window.clearTimeout(timer);
      demoDone.current = false;
    };
  }, [demoAssign, plan.categories, actions, month, model.fmt.decimals]);
  const rta = model.ms.readyToAssign;
  const shownRta = useTweened(rta);
  const rtaState = rta > 0 ? 'positive' : rta === 0 ? 'zero' : 'negative';
  const overspentCount = [...model.views.keys()].filter((id) => (model.ms.categories[id]?.available ?? 0) < 0).length;
  const note = plan.monthNotes.find((n) => n.month === month)?.note ?? '';
  const firstMonth = plan.settings.firstMonth ?? month;

  const toggle = (id: Id, additive: boolean): void => {
    setSelected((s) => {
      if (!additive) return s.size === 1 && s.has(id) ? new Set() : new Set([id]);
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const views: { id: ViewFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'underfunded', label: 'Underfunded' },
    { id: 'overfunded', label: 'Overfunded' },
    { id: 'available', label: 'Money Available' },
    { id: 'snoozed', label: 'Snoozed' },
  ];

  return (
    <div className="hd-main">
      <section className="hd-work" aria-label={`Plan for ${monthName(month)}`}>
        <header className="hd-planhead">
          <div className="hd-month">
            <button type="button" className="hd-iconbtn" aria-label="Previous month" disabled={month <= firstMonth} onClick={() => {
              setMonth(addMonths(month, -1));
            }}>
              <Icon name="chevronLeft" />
            </button>
            <div>
              <h1>{monthShort(month)}</h1>
              <MonthNote key={month} note={note} onSave={(text) => {
                actions.run((p, ctx) => setMonthNote(p, ctx, { month, note: text }));
              }} />
            </div>
            <button type="button" className="hd-iconbtn" aria-label="Next month" disabled={month >= addMonths(firstMonth, 15)} onClick={() => {
              setMonth(addMonths(month, 1));
            }}>
              <Icon name="chevronRight" />
            </button>
          </div>

          <div className="hd-rta" data-state={rtaState} role="status" aria-live="polite">
            <div>
              <div className="amt">{money(minor(shownRta))}</div>
              <div className="lbl">{rtaState === 'zero' ? 'All Money Assigned' : rtaState === 'negative' ? 'You assigned more than you have' : 'Ready to Assign'}</div>
            </div>
            <button type="button" className="hd-primary" disabled={rta <= 0} aria-haspopup="menu">
              Assign <Icon name="chevronDown" />
            </button>
          </div>

          <div className="hd-headright">
            <button type="button" className="hd-iconbtn" aria-label="Hide amounts" title="Hide amounts">
              <Icon name="eyeOff" size={20} />
            </button>
            <button type="button" className="hd-iconbtn" aria-label="Plan options" title="Display options">
              <Icon name="more" size={20} />
            </button>
          </div>
        </header>

        <div className="hd-views" role="toolbar" aria-label="Focused views">
          {overspentCount > 0 && (
            <button type="button" className="hd-chip alert" aria-pressed={filter === 'overspent'} onClick={() => {
              setFilter(filter === 'overspent' ? 'all' : 'overspent');
            }}>
              <Icon name="warning" /> {overspentCount} Overspent
            </button>
          )}
          {views.map((v) => (
            <button key={v.id} type="button" className="hd-chip" aria-pressed={filter === v.id} onClick={() => {
              setFilter(v.id);
            }}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="hd-toolbar">
          <button type="button" className="hd-toolbtn">
            <Icon name="add" /> Category Group
          </button>
          <button type="button" className="hd-toolbtn" disabled={!history.canUndo} title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={actions.undo}>
            <Icon name="undo" /> Undo
          </button>
          <button type="button" className="hd-toolbtn" disabled={!history.canRedo} title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} onClick={actions.redo}>
            <Icon name="redo" /> Redo
          </button>
          <button type="button" className="hd-toolbtn">
            <Icon name="history" /> Recent Moves
          </button>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>
            {selected.size > 0 ? `${String(selected.size)} selected` : ''}
          </span>
        </div>

        <div className="hd-grid">
          <table aria-label="Categories" aria-multiselectable="true">
            <colgroup>
              <col className="check" />
              <col />
              <col className="money" />
              <col className="money" />
              <col className="money" />
            </colgroup>
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" className="hd-checkbox" aria-label="Select all categories" checked={selected.size > 0} onChange={(e) => {
                    setSelected(e.target.checked ? new Set(model.views.keys()) : new Set());
                  }} />
                </th>
                <th>Category</th>
                <th className="num">Assigned</th>
                <th className="num">Activity</th>
                <th className="num">Available</th>
              </tr>
            </thead>
            <tbody>
              {model.groups.map(({ group, categories }) => {
                const visible = categories.filter((c) => matches(filter, model, c.id));
                if (filter !== 'all' && visible.length === 0) return null;
                const sum = (pick: (id: Id) => number): Minor => minor(categories.reduce((s, c) => s + pick(c.id), 0));
                const isCollapsed = collapsed.has(group.id);
                const avail = sum((id) => model.ms.categories[id]?.available ?? 0);
                return (
                  <GroupRows key={group.id}>
                    <tr className="group">
                      <td className="check" />
                      <td>
                        <span className="groupname">
                          <button type="button" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.name}`} aria-expanded={!isCollapsed} onClick={() => {
                            setCollapsed((s) => {
                              const next = new Set(s);
                              if (next.has(group.id)) next.delete(group.id);
                              else next.add(group.id);
                              return next;
                            });
                          }}>
                            <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} />
                          </button>
                          {group.name}
                        </span>
                      </td>
                      <td className="num">{money(sum((id) => model.ms.categories[id]?.assigned ?? 0))}</td>
                      <td className="num">{money(sum((id) => model.ms.categories[id]?.activity ?? 0))}</td>
                      <td className={`num${avail < 0 ? ' neg' : ''}`}>{money(avail)}</td>
                    </tr>
                    {!isCollapsed &&
                      visible.map((c) => {
                        const cm = model.ms.categories[c.id];
                        const view = model.views.get(c.id);
                        if (!cm || !view) return null;
                        const isSelected = selected.has(c.id);
                        return (
                          <tr
                            key={c.id}
                            className="cat"
                            aria-selected={isSelected}
                            onClick={(e) => {
                              if (e.target instanceof HTMLInputElement) return;
                              toggle(c.id, e.ctrlKey || e.metaKey);
                            }}
                          >
                            <td className="check">
                              <input type="checkbox" className="hd-checkbox" aria-label={`Select ${c.name}`} checked={isSelected} onChange={() => {
                                toggle(c.id, true);
                              }} />
                            </td>
                            <td>
                              <div className="hd-catname">
                                <span className="name">{c.name}</span>
                                {view.message !== '' && <span className={`msg ${view.messageTone}`}>{view.message}</span>}
                                {view.bar && <Bar bar={view.bar} state={view.barState} />}
                              </div>
                            </td>
                            <td className="num">
                              <AssignedInput
                                label={`Assigned in ${monthName(month)} for ${c.name}`}
                                value={cm.assigned}
                                decimals={model.fmt.decimals}
                                money={money}
                                onCommit={(amount) => {
                                  actions.run((p, ctx) => setAssigned(p, ctx, { month, categoryId: c.id, amount }));
                                }}
                                onError={actions.notify}
                              />
                            </td>
                            <td className="num">{money(cm.activity)}</td>
                            <td className="num">
                              <Pill view={view} value={cm.available} money={money} />
                            </td>
                          </tr>
                        );
                      })}
                  </GroupRows>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <Inspector model={model} selected={selected} actions={actions} />
    </div>
  );
}

function GroupRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Pill({ view, value, money }: { view: CategoryView; value: Minor; money: (m: Minor) => string }) {
  const shown = useTweened(value);
  const amount = money(minor(shown));
  const icon = view.state === 'funded' ? 'checkmark' : view.state === 'underfunded' ? 'clock' : view.state === 'overspent' ? 'warning' : view.state === 'snoozed' ? 'snooze' : null;
  const label = { funded: 'funded', underfunded: 'underfunded', overspent: 'overspent', zero: 'empty', snoozed: 'snoozed' }[view.state];
  return (
    <span className="hd-pill" data-state={view.state} title={view.message || undefined}>
      {view.credit && <Icon name="card" className="always" />}
      {icon && <Icon name={icon} />}
      <span className="visually-hidden">{label}: </span>
      {amount}
    </span>
  );
}

export function Bar({ bar, state }: { bar: BarView; state: CategoryView['state'] }) {
  const segs = Array.from({ length: bar.segments }, (_, i) => i);
  const per = 100 / bar.segments;
  return (
    <div className="hd-bar bar" data-state={state} aria-hidden="true">
      {segs.map((i) => {
        const fill = Math.max(0, Math.min(per, bar.fillPercent - i * per)) / per;
        const spent = Math.max(0, Math.min(per, bar.spentPercent - i * per)) / per;
        return (
          <span className="seg" key={i}>
            <span className="fill" style={{ transform: `scaleX(${String(fill)})` }} />
            <span className="spent" style={{ transform: `scaleX(${String(spent)})` }} />
          </span>
        );
      })}
    </div>
  );
}

function MonthNote({ note, onSave }: { note: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  if (!editing) {
    return (
      <button type="button" className="hd-toolbtn" style={{ height: 20, padding: '0 6px', color: 'var(--c-text-subtle)', fontWeight: 400, fontSize: 12 }} onClick={() => {
        setDraft(note);
        setEditing(true);
      }}>
        {note === '' ? 'Enter a note…' : note}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className="hd-assign"
      style={{ textAlign: 'left', height: 22, fontSize: 12, marginLeft: 6 }}
      aria-label="Month note"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={() => {
        setEditing(false);
        if (draft !== note) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(note);
          setEditing(false);
        }
      }}
    />
  );
}

function AssignedInput({
  label,
  value,
  decimals,
  money,
  onCommit,
  onError,
}: {
  label: string;
  value: Minor;
  decimals: number;
  money: (m: Minor) => string;
  onCommit: (amount: Minor) => void;
  onError: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  const plain = (m: Minor): string => {
    const digits = String(Math.abs(m)).padStart(decimals + 1, '0');
    const text = decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
    return m < 0 ? `-${text}` : text;
  };
  const commit = (): void => {
    if (draft === null || done.current) return;
    try {
      const amount = parseDecimal(draft.trim() === '' ? '0' : draft.replace(/[,$\s]/g, ''), decimals);
      setDraft(null);
      if (amount !== value) onCommit(amount);
    } catch {
      setDraft(null);
      onError(`"${draft}" isn't an amount.`);
    }
  };
  return (
    <input
      className="hd-assign"
      aria-label={label}
      value={draft ?? money(value)}
      onFocus={(e) => {
        done.current = false;
        setDraft(value === ZERO ? '' : plain(value));
        const input = e.currentTarget;
        requestAnimationFrame(() => {
          input.select();
        });
      }}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          done.current = true;
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          done.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
