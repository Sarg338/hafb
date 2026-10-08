// The Plan header (S4.1, S4.3): month navigation with Today and the month picker, the month note,
// the Ready to Assign banner (breakdown, Assign, Fix This), Hide Amounts and Display Options.
import { useMemo, useRef, useState } from 'react';
import { READY_TO_ASSIGN } from '@hafb/engine';
import { addMonths, minor, monthOf, monthParts, type ISODate, type Month } from '@hafb/shared';
import { applyPlanChange, moveMoney, setMonthNote } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { prefs } from '../../shell/prefs.ts';
import { RtaBanner, type RtaState } from '../../ui/Banner.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { MenuButton, type MenuItem } from '../../ui/Menu.tsx';
import { MonthPicker } from '../../ui/MonthPicker.tsx';
import { Popover } from '../../ui/Popover.tsx';
import { useTweened } from '../../ui/useTweened.ts';
import type { MoneyText } from '../shared/money.ts';
import { assignChoices } from './assignOptions.ts';
import { AssignPopover, BreakdownPopover, SourcePopover } from './MoneyPopovers.tsx';
import { assignTargets, readyToAssignBreakdown, unassignSources } from './moneyMoves.ts';
import type { PlanModel } from './planModel.ts';
import { planBounds } from './planMonths.ts';
import styles from './PlanScreen.module.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: Month): string => MONTH_NAMES[monthParts(m).month - 1] ?? m;
export const monthShort = (m: Month): string => `${monthName(m).slice(0, 3)} ${String(monthParts(m).year)}`;

type Open = null | 'picker' | 'breakdown' | 'assign' | 'fix';

export function PlanHeader({
  model,
  today,
  setMonth,
  money,
  actions,
  hideAmounts,
  displayItems,
  onDisplay,
}: {
  model: PlanModel;
  today: ISODate;
  setMonth: (m: Month) => void;
  money: MoneyText;
  actions: Actions;
  hideAmounts: boolean;
  displayItems: MenuItem[];
  onDisplay: (id: string) => void;
}) {
  const { plan, month } = model;
  const current = monthOf(today);
  const bounds = useMemo(() => planBounds(plan, today), [plan, today]);
  const [open, setOpen] = useState<Open>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const rtaRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const readyToAssign = model.ms.readyToAssign;
  const shownRta = useTweened(readyToAssign);
  const rtaState: RtaState = readyToAssign > 0 ? 'positive' : readyToAssign === 0 ? 'zero' : 'negative';
  const note = plan.monthNotes.find((n) => n.month === month)?.note ?? '';
  const close = (focus?: HTMLElement | null): void => {
    setOpen(null);
    focus?.focus();
  };
  const categoryIds = [...model.views.keys()];

  return (
    <header className={styles.head}>
      <div className={styles.month}>
        <IconButton icon="chevronLeft" label="Previous month" disabled={month <= bounds.min} onClick={() => {
          setMonth(addMonths(month, -1));
        }} />
        <div>
          <h1 className={styles.title}>
            <button
              ref={titleRef}
              type="button"
              className={styles.titleButton}
              aria-haspopup="dialog"
              aria-expanded={open === 'picker'}
              aria-label={`${monthName(month)} ${String(monthParts(month).year)}. Choose a month`}
              onClick={() => {
                setOpen(open === 'picker' ? null : 'picker');
              }}
            >
              {monthShort(month)}
            </button>
          </h1>
          <MonthNote
            key={month}
            note={note}
            onSave={(text) => {
              actions.run((p, ctx) => setMonthNote(p, ctx, { month, note: text }));
            }}
          />
        </div>
        <IconButton icon="chevronRight" label="Next month" disabled={month >= bounds.max} onClick={() => {
          setMonth(addMonths(month, 1));
        }} />
        {month !== current && (
          <Button size="small" className={styles.today} onClick={() => {
            setMonth(current);
          }}>
            Today
          </Button>
        )}
        {open === 'picker' && (
          <Popover open onClose={() => {
            close(titleRef.current);
          }} anchor={titleRef} role="dialog" label="Choose a month" placement="bottom-start">
            <MonthPicker
              value={month}
              current={current}
              min={bounds.min}
              max={bounds.max}
              onSelect={(m) => {
                close(titleRef.current);
                setMonth(m);
              }}
            />
          </Popover>
        )}
      </div>

      <RtaBanner
        state={rtaState}
        amount={money(minor(shownRta))}
        detailsRef={rtaRef}
        detailsExpanded={open === 'breakdown'}
        onDetails={() => {
          setOpen(open === 'breakdown' ? null : 'breakdown');
        }}
        action={
          rtaState === 'negative' ? (
            <Button ref={actionRef} variant="danger" className={styles.fix} aria-haspopup="dialog" aria-expanded={open === 'fix'} onClick={() => {
              setOpen(open === 'fix' ? null : 'fix');
            }}>
              Fix This
            </Button>
          ) : (
            <Button ref={actionRef} variant="primary" iconEnd="chevronDown" aria-haspopup="dialog" aria-expanded={open === 'assign'} onClick={() => {
              setOpen(open === 'assign' ? null : 'assign');
            }}>
              Assign
            </Button>
          )
        }
      />
      {open === 'breakdown' && (
        <BreakdownPopover anchor={rtaRef} breakdown={readyToAssignBreakdown(model.ms, month)} money={money} onClose={() => {
          close(rtaRef.current);
        }} />
      )}
      {open === 'assign' && (
        <AssignPopover
          anchor={actionRef}
          readyToAssign={readyToAssign}
          format={model.fmt}
          money={money}
          choices={assignChoices(model, categoryIds, 'all')}
          targets={assignTargets(model)}
          onClose={() => {
            close(actionRef.current);
          }}
          onAuto={(choice) => {
            close(actionRef.current);
            actions.run((p, ctx) => applyPlanChange(p, ctx, { change: choice.commit, kind: 'autoAssign', label: `Auto-Assign: ${choice.label}` }));
          }}
          onManual={(to, amount) => {
            close(actionRef.current);
            actions.run((p, ctx) => moveMoney(p, ctx, { month, from: READY_TO_ASSIGN, to, amount }));
          }}
        />
      )}
      {open === 'fix' && (
        <SourcePopover
          anchor={actionRef}
          title="Un-assign money from"
          format={model.fmt}
          sources={unassignSources(model)}
          empty="No category has money to give back this month."
          onClose={() => {
            close(actionRef.current);
          }}
          onSubmit={(from) => {
            close(actionRef.current);
            const available = model.ms.categories[from]?.available ?? 0;
            const amount = minor(Math.min(0 - readyToAssign, available));
            if (amount > 0) actions.run((p, ctx) => moveMoney(p, ctx, { month, from, to: READY_TO_ASSIGN, amount }));
          }}
        />
      )}

      <div className={styles.headRight}>
        <IconButton
          icon={hideAmounts ? 'eye' : 'eyeOff'}
          label={hideAmounts ? 'Show amounts' : 'Hide amounts'}
          iconSize={20}
          aria-pressed={hideAmounts}
          onClick={() => {
            prefs.update({ hideAmounts: !hideAmounts });
          }}
        />
        <MenuButton
          label="Display options"
          items={displayItems}
          onSelect={onDisplay}
          placement="bottom-end"
          trigger={(t) => <IconButton {...t} icon="more" label="Display options" iconSize={20} />}
        />
      </div>
    </header>
  );
}

function MonthNote({ note, onSave }: { note: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  if (!editing) {
    return (
      <button type="button" className={styles.noteButton} onClick={() => {
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
      className={styles.noteInput}
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
          e.stopPropagation();
          setDraft(note);
          setEditing(false);
        }
      }}
    />
  );
}
