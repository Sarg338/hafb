// The Plan screen (S4.1): month header with Ready to Assign, focused views, and the category grid,
// rebuilt from the component library in the approved S3.1 look (ADR 0007). Numbers come from the
// engine through planModel; edits go through store commands (CLAUDE.md §10).
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { Id } from '@hafb/engine';
import { addMonths, minor, monthOf, monthParts, type ISODate, type Minor, type Month } from '@hafb/shared';
import { applyPlanChange, setAssigned, setMonthNote, type PlanData } from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { Inspector } from '../../design/Inspector.tsx';
import { usePrefs, prefs } from '../../shell/prefs.ts';
import { RtaBanner, type RtaState } from '../../ui/Banner.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Chip } from '../../ui/Chip.tsx';
import { cx } from '../../ui/cx.ts';
import { DataGrid, type GridColumn } from '../../ui/grid/DataGrid.tsx';
import { MoneyCellEditor } from '../../ui/grid/editors.tsx';
import { MenuButton, type MenuItem } from '../../ui/Menu.tsx';
import { MonthPicker } from '../../ui/MonthPicker.tsx';
import { Pill } from '../../ui/Pill.tsx';
import { Popover } from '../../ui/Popover.tsx';
import { ProgressBar } from '../../ui/ProgressBar.tsx';
import { useShortcut } from '../../ui/shortcuts/ShortcutProvider.tsx';
import { useTweened } from '../../ui/useTweened.ts';
import { moneyText, type MoneyText } from '../shared/money.ts';
import { NARROW_WINDOW, useMediaQuery } from '../shared/useMediaQuery.ts';
import { assignChoices } from './assignOptions.ts';
import { planModel } from './planModel.ts';
import { planBounds } from './planMonths.ts';
import { rectOf, usePlanEditing } from './PlanEditing.tsx';
import { groupIds, HIDDEN_SECTION_ID, overspentCount, planRows, type PlanCategoryRow, type PlanGroupRow, type PlanRow, type ViewFilter } from './planRows.ts';
import { usePlanDrag } from './usePlanDrag.ts';
import styles from './PlanScreen.module.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: Month): string => MONTH_NAMES[monthParts(m).month - 1] ?? m;
export const monthShort = (m: Month): string => `${monthName(m).slice(0, 3)} ${String(monthParts(m).year)}`;

const VIEWS: { id: ViewFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'underfunded', label: 'Underfunded' },
  { id: 'overfunded', label: 'Overfunded' },
  { id: 'available', label: 'Money Available' },
  { id: 'snoozed', label: 'Snoozed' },
];

const DEFAULT_COLLAPSED: readonly string[] = [HIDDEN_SECTION_ID];

export interface PlanScreenProps {
  plan: PlanData;
  /** The plan file, for per-plan device preferences (collapsed groups). */
  planPath: string;
  today: ISODate;
  month: Month;
  setMonth: (m: Month) => void;
  actions: Actions;
  history: { canUndo: boolean; canRedo: boolean; undoLabel: string | undefined; redoLabel: string | undefined };
  /** Rendered on the inspector's left edge (the shell's resize handle). */
  inspectorEdge?: ReactNode;
}

export function PlanScreen({ plan, planPath, today, month, setMonth, actions, history, inspectorEdge }: PlanScreenProps) {
  const p = usePrefs();
  const model = planModel(plan, month, today);
  const money = useMemo(() => moneyText(model.fmt, p.hideAmounts), [model.fmt, p.hideAmounts]);
  const narrow = useMediaQuery(NARROW_WINDOW);
  const moneyWidth = narrow ? 112 : 140;
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const collapsed = useMemo(() => new Set(p.collapsedGroups[planPath] ?? DEFAULT_COLLAPSED), [p.collapsedGroups, planPath]);
  const setCollapsed = useCallback(
    (next: ReadonlySet<string>) => {
      prefs.update({ collapsedGroups: { ...prefs.get().collapsedGroups, [planPath]: [...next] } });
    },
    [planPath],
  );

  const rows = useMemo(() => planRows(model, filter), [model, filter]);
  const rowInfo = useMemo(() => new Map(rows.map((r) => [r.id, { row: r.data, groupId: r.groupId }])), [rows]);
  const [request, setRequest] = useState<{ cell: { rowId: string; columnId: string }; edit: boolean; key: number } | undefined>(undefined);
  const editing = usePlanEditing({
    plan,
    month,
    today,
    actions,
    onCreated: (rowId, groupId) => {
      // Show it: open its group, leave a filter that would hide it, and move the grid there.
      if (collapsed.has(groupId)) setCollapsed(new Set([...collapsed].filter((g) => g !== groupId)));
      setFilter('all');
      setRequest((r) => ({ cell: { rowId, columnId: 'category' }, edit: false, key: (r?.key ?? 0) + 1 }));
    },
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = usePlanDrag({ wrap: wrapRef, rows: rowInfo, onDropCategory: editing.moveCategory, onDropGroup: editing.moveGroup });
  const justDragged = drag.justDragged;
  const openRename = editing.openRename;
  const openAddCategory = editing.openAddCategory;
  const nameActions = useMemo(
    () => ({
      rename: (id: string, el: Element) => {
        if (!justDragged.current) openRename(id, rectOf(el));
      },
      addCategory: (groupId: string, el: Element) => {
        openAddCategory(groupId, rectOf(el));
      },
    }),
    [justDragged, openRename, openAddCategory],
  );
  const overspent = overspentCount(model);
  // Leaving a filter that no longer applies (the last overspent category got covered).
  if (filter === 'overspent' && overspent === 0) setFilter('all');

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(groupIds(rows)));
  }, [rows, setCollapsed]);
  const expandAll = useCallback(() => {
    setCollapsed(new Set());
  }, [setCollapsed]);
  useShortcut({ id: 'plan.collapseAll', keys: 'Ctrl+ArrowUp', description: 'Collapse all category groups', group: 'Plan', scope: 'screen', run: collapseAll });
  useShortcut({ id: 'plan.expandAll', keys: 'Ctrl+ArrowDown', description: 'Expand all category groups', group: 'Plan', scope: 'screen', run: expandAll });

  const assign = useCallback(
    (categoryId: Id, amount: Minor) => {
      actions.run((pl, ctx) => setAssigned(pl, ctx, { month, categoryId, amount }));
    },
    [actions, month],
  );

  const columns = useMemo(
    (): GridColumn<PlanRow>[] => [
      {
        id: 'category',
        header: 'Category',
        width: narrow ? 180 : 220,
        flex: true,
        render: (r) =>
          r.data.kind === 'group' ? <GroupName id={r.id} row={r.data} on={nameActions} /> : <CategoryCell row={r.data} showBar={p.showProgressBars} on={nameActions} />,
      },
      {
        id: 'assigned',
        header: 'Assigned',
        width: moneyWidth,
        align: 'end',
        editable: (r) => r.data.kind === 'category',
        render: (r) => money(r.data.assigned),
        editor: ({ row, seed, done }) =>
          row.data.kind === 'category' ? (
            <MoneyCellEditor
              value={row.data.assigned}
              format={model.fmt}
              seed={seed}
              label={`Assigned in ${monthName(month)} for ${row.data.name}`}
              done={done}
              onCommit={(v) => {
                if (row.data.kind === 'category' && v !== row.data.assigned) assign(row.data.id, v);
              }}
            />
          ) : null,
      },
      { id: 'activity', header: 'Activity', width: moneyWidth, align: 'end', render: (r) => money(r.data.activity) },
      {
        id: 'available',
        header: 'Available',
        width: moneyWidth,
        align: 'end',
        render: (r) =>
          r.data.kind === 'group' ? (
            <span className={cx(styles.groupAmount, r.data.available < 0 && styles.negative)}>{money(r.data.available)}</span>
          ) : (
            <AvailablePill row={r.data} money={money} />
          ),
      },
    ],
    [money, model.fmt, month, assign, p.showProgressBars, narrow, moneyWidth, nameActions],
  );

  // Esc deselects all (YNAB), when the grid is navigating rather than editing.
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && e.target instanceof HTMLElement && e.target.matches('[data-cell]') && selected.size > 0) {
      e.preventDefault();
      setSelected(new Set());
    }
  };
  // Ctrl+Up/Down collapse and expand (YNAB) even while a grid cell has focus; the grid would
  // otherwise read them as "first/last row".
  const onGridKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!e.ctrlKey || e.shiftKey || e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (!(e.target instanceof HTMLElement) || !e.target.matches('[data-cell]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowUp') collapseAll();
    else expandAll();
  };

  const displayItems: MenuItem[] = [
    { id: 'bars', label: 'Show progress bars', checked: p.showProgressBars },
    { id: 'nocolor', label: 'Differentiate without color', checked: p.noColor },
    { id: 'sep', label: '', separator: true },
    { id: 'collapse', label: 'Collapse all groups', shortcut: 'Ctrl+↑' },
    { id: 'expand', label: 'Expand all groups', shortcut: 'Ctrl+↓' },
  ];

  return (
    <div className={styles.main}>
      <section className={styles.work} aria-label={`Plan for ${monthName(month)}`}>
        <PlanHeader
          plan={plan}
          today={today}
          month={month}
          setMonth={setMonth}
          readyToAssign={model.ms.readyToAssign}
          money={money}
          assignMenu={assignChoices(model, [...model.views.keys()], 'all').map((c) => ({
            id: c.id,
            label: c.label,
            detail: money(c.change.total),
            disabled: c.commit.deltas.length === 0,
          }))}
          onAssign={(id) => {
            const choice = assignChoices(model, [...model.views.keys()], 'all').find((c) => c.id === id);
            if (choice) actions.run((pl, ctx) => applyPlanChange(pl, ctx, { change: choice.commit, kind: 'autoAssign', label: `Auto-Assign: ${choice.label}` }));
          }}
          onNote={(text) => {
            actions.run((pl, ctx) => setMonthNote(pl, ctx, { month, note: text }));
          }}
          hideAmounts={p.hideAmounts}
          displayItems={displayItems}
          onDisplay={(id) => {
            if (id === 'bars') prefs.update({ showProgressBars: !p.showProgressBars });
            else if (id === 'nocolor') prefs.update({ noColor: !p.noColor });
            else if (id === 'collapse') collapseAll();
            else if (id === 'expand') expandAll();
          }}
        />

        <div className={styles.views} role="toolbar" aria-label="Focused views">
          {overspent > 0 && (
            <Chip variant="alert" icon="warning" pressed={filter === 'overspent'} onClick={() => {
              setFilter(filter === 'overspent' ? 'all' : 'overspent');
            }}>
              {overspent} Overspent
            </Chip>
          )}
          {VIEWS.map((v) => (
            <Chip key={v.id} pressed={filter === v.id} onClick={() => {
              setFilter(v.id);
            }}>
              {v.label}
            </Chip>
          ))}
        </div>

        <div className={styles.toolbar}>
          <Button
            variant="toolbar"
            icon="add"
            onClick={(e) => {
              editing.openAddGroup(rectOf(e.currentTarget));
            }}
          >
            Category Group
          </Button>
          <Button variant="toolbar" icon="undo" disabled={!history.canUndo} title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={actions.undo}>
            Undo
          </Button>
          <Button variant="toolbar" icon="redo" disabled={!history.canRedo} title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} onClick={actions.redo}>
            Redo
          </Button>
          <Button variant="toolbar" icon="history" disabled title="Recent Moves arrives in S5.7">
            Recent Moves
          </Button>
          <span className={styles.spacer} />
          <span className={styles.count} aria-live="polite">
            {selected.size > 0 ? `${String(selected.size)} selected` : ''}
          </span>
        </div>

        <div ref={wrapRef} className={styles.gridWrap} onKeyDown={onGridKeyDown} onKeyDownCapture={onGridKeyDownCapture} onPointerDown={drag.onPointerDown}>
          <DataGrid<PlanRow>
            label="Categories"
            rows={rows}
            columns={columns}
            density="plan"
            selectable
            selected={selected}
            onSelectionChange={setSelected}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            editOnClick={EDIT_ON_CLICK}
            enterMoves="down"
            onRowContextMenu={editing.openMenu}
            {...(request ? { request } : {})}
            empty={filter === 'all' ? 'No categories yet. Add a category group to start your plan.' : 'No categories in this view this month.'}
          />
          {drag.indicator && <div className={styles.dropLine} style={{ top: drag.indicator.top }} aria-hidden="true" />}
        </div>
        {editing.element}
      </section>
      {inspectorEdge !== undefined && <div className={styles.inspectorEdge}>{inspectorEdge}</div>}
      <Inspector model={model} selected={selected} actions={actions} />
    </div>
  );
}

const EDIT_ON_CLICK = ['assigned'] as const;

interface NameActions {
  rename: (id: string, el: Element) => void;
  addCategory: (groupId: string, el: Element) => void;
}

/** Keeps the grid from also selecting the row (or stealing focus) when a name button is pressed. */
const stopGrid = (e: MouseEvent): void => {
  e.stopPropagation();
};

function CategoryCell({ row, showBar, on }: { row: PlanCategoryRow; showBar: boolean; on: NameActions }) {
  const { view } = row;
  const hidden = row.groupId === HIDDEN_SECTION_ID;
  return (
    <span className={styles.catName}>
      {row.payment ? (
        <span className={styles.name} data-drag={hidden ? undefined : 'category'} data-drag-id={row.id}>
          {row.name}
        </span>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          className={cx(styles.name, styles.nameButton)}
          data-drag={hidden ? undefined : 'category'}
          data-drag-id={row.id}
          title={hidden ? undefined : 'Rename, hide or delete (drag to move)'}
          onMouseDown={stopGrid}
          onClick={(e) => {
            on.rename(row.id, e.currentTarget);
          }}
        >
          {row.name}
        </button>
      )}
      <span className={cx(styles.message, view.messageTone === 'warn' && styles.warn, view.messageTone === 'bad' && styles.bad)}>{view.message}</span>
      {showBar && view.bar && (
        <span className={styles.bar}>
          <ProgressBar segments={view.bar.segments} fillPercent={view.bar.fillPercent} spentPercent={view.bar.spentPercent} state={view.barState} />
        </span>
      )}
    </span>
  );
}

function GroupName({ id, row, on }: { id: string; row: PlanGroupRow; on: NameActions }) {
  if (row.system !== null) return <span className={styles.groupLabel}>{row.name}</span>;
  return (
    <span className={styles.groupLabel}>
      <button
        type="button"
        tabIndex={-1}
        className={cx(styles.name, styles.nameButton, styles.groupButton)}
        data-drag="group"
        data-drag-id={id}
        title="Rename, hide or delete (drag to move)"
        onMouseDown={stopGrid}
        onClick={(e) => {
          on.rename(id, e.currentTarget);
        }}
      >
        {row.name}
      </button>
      <IconButton
        icon="add"
        size="small"
        label={`Add a category to ${row.name}`}
        tabIndex={-1}
        className={styles.groupAdd}
        onMouseDown={stopGrid}
        onClick={(e) => {
          on.addCategory(id, e.currentTarget);
        }}
      />
    </span>
  );
}

function AvailablePill({ row, money }: { row: PlanCategoryRow; money: MoneyText }) {
  const shown = useTweened(row.available);
  return (
    <Pill state={row.view.state} credit={row.view.credit} {...(row.view.message ? { title: row.view.message } : {})}>
      {money(minor(shown))}
    </Pill>
  );
}

// ---- header ---------------------------------------------------------------------------------------

function PlanHeader({
  plan,
  today,
  month,
  setMonth,
  readyToAssign,
  money,
  assignMenu,
  onAssign,
  onNote,
  hideAmounts,
  displayItems,
  onDisplay,
}: {
  plan: PlanData;
  today: ISODate;
  month: Month;
  setMonth: (m: Month) => void;
  readyToAssign: Minor;
  money: MoneyText;
  assignMenu: MenuItem[];
  onAssign: (id: string) => void;
  onNote: (text: string) => void;
  hideAmounts: boolean;
  displayItems: MenuItem[];
  onDisplay: (id: string) => void;
}) {
  const current = monthOf(today);
  const bounds = useMemo(() => planBounds(plan, today), [plan, today]);
  const [picking, setPicking] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const shownRta = useTweened(readyToAssign);
  const rtaState: RtaState = readyToAssign > 0 ? 'positive' : readyToAssign === 0 ? 'zero' : 'negative';
  const note = plan.monthNotes.find((n) => n.month === month)?.note ?? '';

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
              aria-expanded={picking}
              aria-label={`${monthName(month)} ${String(monthParts(month).year)}. Choose a month`}
              onClick={() => {
                setPicking(!picking);
              }}
            >
              {monthShort(month)}
            </button>
          </h1>
          <MonthNote key={month} note={note} onSave={onNote} />
        </div>
        <IconButton icon="chevronRight" label="Next month" disabled={month >= bounds.max} onClick={() => {
          setMonth(addMonths(month, 1));
        }} />
        <Popover open={picking} onClose={() => {
          setPicking(false);
          titleRef.current?.focus();
        }} anchor={titleRef} role="dialog" label="Choose a month" placement="bottom-start">
          <MonthPicker
            value={month}
            current={current}
            min={bounds.min}
            max={bounds.max}
            onSelect={(m) => {
              setPicking(false);
              setMonth(m);
              titleRef.current?.focus();
            }}
          />
        </Popover>
      </div>

      <RtaBanner
        state={rtaState}
        amount={money(minor(shownRta))}
        action={<MenuButton label="Assign" variant="primary" items={assignMenu} onSelect={onAssign} placement="bottom-end" />}
      />

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
