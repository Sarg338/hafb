// Gallery: the S3.4 editable grid on the sample household. Edits stay in local state.
// Deep links: #/gallery?section=grid&edit=1 opens an editor; &select=3 selects the first rows.
import { useCallback, useMemo, useState } from 'react';
import { READY_TO_ASSIGN, type ClearedState } from '@hafb/engine';
import { formatMoney, minor, neg, uuidv7Generator, type ISODate, type Minor } from '@hafb/shared';
import { applyChanges, setAssigned, type PlanData } from '@hafb/store';
import { planModel, moneyFormat } from '../../design/planModel.ts';
import { buildSamplePlan, SAMPLE_TODAY } from '../../design/sample.ts';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { cx } from '../../ui/cx.ts';
import { DataGrid, type GridColumn } from '../../ui/grid/DataGrid.tsx';
import { DateCellEditor, MoneyCellEditor, PickerCellEditor, TextCellEditor, type PickerSlotProps } from '../../ui/grid/editors.tsx';
import type { CellRef, GridRow } from '../../ui/grid/types.ts';
import { rememberFocus } from '../../ui/focus.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MenuList, type MenuItem } from '../../ui/Menu.tsx';
import { PayeePicker } from '../../ui/PayeePicker.tsx';
import { Pill, type MoneyState } from '../../ui/Pill.tsx';
import { categoryPickerData, payeeGroups } from '../../ui/pickerData.ts';
import { Popover } from '../../ui/Popover.tsx';
import { ProgressBar } from '../../ui/ProgressBar.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';
import styles from './grid.module.css';

function deepLink(): { edit: boolean; select: number } {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  return { edit: params.get('edit') === '1', select: Number(params.get('select') ?? '0') || 0 };
}

const newId = uuidv7Generator(
  () => Date.now(),
  (n) => crypto.getRandomValues(new Uint8Array(n)),
);

// ---- register ------------------------------------------------------------------------------------

interface TxRow {
  id: string;
  accountId: string;
  date: ISODate;
  payeeId: string | null;
  categoryId: string | null;
  memo: string;
  amount: Minor;
  cleared: ClearedState;
  splitCount: number;
  transferAccountId: string | null;
}

function registerRows(plan: PlanData): GridRow<TxRow>[] {
  return plan.transactions
    .filter((t) => t.deletedAt === undefined)
    .toSorted((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((t) => ({
      kind: 'item',
      id: t.id,
      data: {
        id: t.id,
        accountId: t.accountId,
        date: t.date,
        payeeId: t.payeeId ?? null,
        categoryId: t.categoryId,
        memo: t.memo ?? '',
        amount: t.amount,
        cleared: t.cleared,
        splitCount: t.subtransactions?.length ?? 0,
        transferAccountId: t.transferAccountId ?? null,
      },
    }));
}

const NO_POINT = { top: 0, left: 0, width: 0, height: 0 };

const MENU: MenuItem[] = [
  { id: 'edit', label: 'Edit', icon: 'edit', shortcut: 'Enter' },
  { id: 'flag', label: 'Flag', icon: 'flag' },
  { id: 'clear', label: 'Mark cleared', icon: 'cleared' },
  { id: 'sep', label: '', separator: true },
  { id: 'delete', label: 'Delete', icon: 'dismiss', danger: true, shortcut: 'Del' },
];

function RegisterDemo({ plan, link }: { plan: PlanData; link: { edit: boolean; select: number } }) {
  const fmt = moneyFormat(plan);
  const [rows, setRows] = useState(() => registerRows(plan));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(rows.slice(0, link.select).map((r) => r.id)));
  const [menu, setMenu] = useState<{ rowId: string; at: { top: number; left: number; width: number; height: number }; restore: () => void } | null>(null);
  const [request, setRequest] = useState<{ cell: CellRef; edit: boolean; key: number } | undefined>(undefined);
  const [widths, setWidths] = useState<Record<string, number>>({});

  const names = useMemo(
    () => ({
      payee: new Map(plan.payees.map((p) => [p.id, p.name])),
      category: new Map([...plan.categories.map((c): [string, string] => [c.id, c.name]), [READY_TO_ASSIGN, 'Ready to Assign']]),
      account: new Map(plan.accounts.map((a) => [a.id, a.name])),
    }),
    [plan],
  );
  const payees = useMemo(() => payeeGroups(plan), [plan]);
  const categories = useMemo(() => categoryPickerData(plan, '2026-10', SAMPLE_TODAY), [plan]);

  const update = useCallback((id: string, patch: Partial<TxRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, data: { ...r.data, ...patch } } : r)));
  }, []);

  // Stable picker slots: the per-row value comes in through the slot props.
  const PayeeSlot = useMemo(
    () =>
      function PayeeSlot(p: PickerSlotProps) {
        return <PayeePicker groups={payees} {...p} />;
      },
    [payees],
  );
  const CategorySlot = useMemo(
    () =>
      function CategorySlot(p: PickerSlotProps) {
        return <CategoryPicker groups={categories.groups} available={categories.available} format={fmt} {...p} />;
      },
    [categories, fmt],
  );

  const columns = useMemo((): GridColumn<TxRow>[] => {
    const editable = (r: GridRow<TxRow>) => r.kind === 'item';
    return [
      { id: 'account', header: 'Account', width: 148, render: (r) => names.account.get(r.data.accountId) ?? '' },
      {
        id: 'date',
        header: 'Date',
        width: 98,
        editable,
        render: (r) => `${r.data.date.slice(5, 7)}/${r.data.date.slice(8, 10)}/${r.data.date.slice(0, 4)}`,
        editor: ({ row, done }) => (
          <DateCellEditor value={row.data.date} format={plan.settings.dateFormat} today={SAMPLE_TODAY} label="Date" done={done} onCommit={(date) => {
            update(row.id, { date });
          }} />
        ),
      },
      {
        id: 'payee',
        header: 'Payee',
        width: 188,
        editable: (r) => r.data.transferAccountId === null,
        render: (r) =>
          r.data.transferAccountId !== null ? (
            <span className={styles.transfer}>
              <Icon name="transfer" />
              <span>{names.payee.get(r.data.payeeId ?? '') ?? ''}</span>
            </span>
          ) : (
            names.payee.get(r.data.payeeId ?? '') ?? ''
          ),
        editor: ({ row, seed, done }) => (
          <PickerCellEditor Picker={PayeeSlot} value={row.data.payeeId} seed={seed} done={done} onCommit={(payeeId) => {
            update(row.id, { payeeId });
          }} />
        ),
      },
      {
        id: 'category',
        header: 'Category',
        width: 160,
        editable: (r) => r.data.splitCount === 0 && r.data.transferAccountId === null,
        render: (r) =>
          r.data.splitCount > 0 ? (
            <span className={styles.transfer}>
              <Icon name="split" />
              <span>Split ({r.data.splitCount})</span>
            </span>
          ) : r.data.categoryId === null ? (
            <span className={styles.muted}>{r.data.transferAccountId === null ? 'Uncategorized' : ''}</span>
          ) : (
            names.category.get(r.data.categoryId) ?? ''
          ),
        editor: ({ row, seed, done }) => (
          <PickerCellEditor Picker={CategorySlot} value={row.data.categoryId} seed={seed} done={done} onCommit={(categoryId) => {
            update(row.id, { categoryId });
          }} />
        ),
      },
      {
        id: 'memo',
        header: 'Memo',
        width: 120,
        flex: true,
        editable,
        render: (r) => <span className={cx(styles.muted)}>{r.data.memo}</span>,
        editor: ({ row, seed, done }) => (
          <TextCellEditor value={row.data.memo} seed={seed} label="Memo" placeholder="Memo" done={done} onCommit={(memo) => {
            update(row.id, { memo });
          }} />
        ),
      },
      {
        id: 'outflow',
        header: 'Outflow',
        width: 104,
        align: 'end',
        editable: (r) => r.data.splitCount === 0,
        render: (r) => (r.data.amount < 0 ? formatMoney(neg(r.data.amount), fmt) : ''),
        editor: ({ row, seed, done }) => (
          <MoneyCellEditor value={row.data.amount < 0 ? neg(row.data.amount) : minor(0)} format={fmt} seed={seed} label="Outflow" done={done} onCommit={(v) => {
            update(row.id, { amount: v === 0 ? minor(0) : neg(v) });
          }} />
        ),
      },
      {
        id: 'inflow',
        header: 'Inflow',
        width: 104,
        align: 'end',
        editable: (r) => r.data.splitCount === 0,
        render: (r) => (r.data.amount > 0 ? formatMoney(r.data.amount, fmt) : ''),
        editor: ({ row, seed, done }) => (
          <MoneyCellEditor value={row.data.amount > 0 ? row.data.amount : minor(0)} format={fmt} seed={seed} label="Inflow" done={done} onCommit={(v) => {
            update(row.id, { amount: v });
          }} />
        ),
      },
      {
        id: 'cleared',
        header: 'Cleared',
        headerHidden: true,
        width: 44,
        align: 'center',
        resizable: false,
        render: (r) => (
          <span className={cx(styles.cleared, r.data.cleared !== 'uncleared' && styles.on)} title={r.data.cleared}>
            <Icon name={r.data.cleared === 'reconciled' ? 'lock' : r.data.cleared === 'cleared' ? 'cleared' : 'uncleared'} />
            <span className="visually-hidden">{r.data.cleared}</span>
          </span>
        ),
      },
    ];
  }, [names, plan.settings.dateFormat, fmt, update, PayeeSlot, CategorySlot]);

  const addAnother = useCallback((afterId: string) => {
    const source = rows.find((r) => r.id === afterId);
    const id = newId();
    const blank: GridRow<TxRow> = {
      kind: 'item',
      id,
      data: { id, accountId: source?.data.accountId ?? plan.accounts[0]?.id ?? '', date: SAMPLE_TODAY, payeeId: null, categoryId: null, memo: '', amount: minor(0), cleared: 'uncleared', splitCount: 0, transferAccountId: null },
    };
    setRows((rs) => [blank, ...rs]);
    setRequest((r) => ({ cell: { rowId: id, columnId: 'payee' }, edit: true, key: (r?.key ?? 0) + 1 }));
  }, [rows, plan.accounts]);

  const closeMenu = (): void => {
    menu?.restore();
    setMenu(null);
  };

  const onMenuSelect = (id: string): void => {
    const targets = menu && selected.has(menu.rowId) ? [...selected] : menu ? [menu.rowId] : [];
    if (id === 'delete') setRows((rs) => rs.filter((r) => !targets.includes(r.id)));
    if (id === 'clear') for (const t of targets) update(t, { cleared: 'cleared' });
    closeMenu();
  };

  const first = rows[0];
  return (
    <>
      <div className={styles.frame}>
        <DataGrid<TxRow>
          label="All transactions"
          rows={rows}
          columns={columns}
          density="register"
          selectable
          defaultSelected={selected}
          onSelectionChange={setSelected}
          columnWidths={widths}
          onColumnWidthsChange={setWidths}
          enterMoves="down"
          onSaveAndAddAnother={addAnother}
          onRowContextMenu={(rowId, p) => {
            // Focus goes back to the grid cell when the menu closes.
            setMenu({ rowId, at: { top: p.y, left: p.x, width: 0, height: 0 }, restore: rememberFocus() });
          }}
          empty="No transactions yet."
          {...(link.edit && first ? { initialActive: { rowId: first.id, columnId: 'memo' }, initialEditing: true } : {})}
          {...(request ? { request } : {})}
        />
      </div>
      <p className={styles.echo} aria-live="polite">
        {rows.length} transactions · {selected.size} selected
        {Object.keys(widths).length > 0 ? ` · resized: ${Object.entries(widths).map(([k, v]) => `${k} ${String(v)}px`).join(', ')}` : ''}
      </p>
      <Popover open={menu !== null} onClose={closeMenu} anchor={menu?.at ?? NO_POINT} role="presentation">
        <MenuList items={MENU} label="Transaction" onSelect={onMenuSelect} onClose={closeMenu} />
      </Popover>
    </>
  );
}

// ---- plan ----------------------------------------------------------------------------------------

interface PlanRow {
  name: string;
  assigned: Minor;
  activity: Minor;
  available: Minor;
  state?: MoneyState;
  credit?: boolean;
  message?: string;
  tone?: 'plain' | 'warn' | 'bad';
  bar?: { segments: number; fillPercent: number; spentPercent: number; state: MoneyState };
}

function PlanDemo({ initial }: { initial: PlanData }) {
  const [plan, setPlan] = useState(initial);
  const month = '2026-10';
  const model = planModel(plan, month, SAMPLE_TODAY);
  const fmt = model.fmt;

  const rows = useMemo((): GridRow<PlanRow>[] => {
    const out: GridRow<PlanRow>[] = [];
    for (const { group, categories } of model.groups) {
      const sum = (pick: (id: string) => number): Minor => minor(categories.reduce((s, c) => s + pick(c.id), 0));
      out.push({
        kind: 'group',
        id: group.id,
        data: {
          name: group.name,
          assigned: sum((id) => model.ms.categories[id]?.assigned ?? 0),
          activity: sum((id) => model.ms.categories[id]?.activity ?? 0),
          available: sum((id) => model.ms.categories[id]?.available ?? 0),
        },
      });
      for (const c of categories) {
        const cm = model.ms.categories[c.id];
        const view = model.views.get(c.id);
        if (!cm || !view) continue;
        out.push({
          kind: 'item',
          id: c.id,
          groupId: group.id,
          data: {
            name: c.name,
            assigned: cm.assigned,
            activity: cm.activity,
            available: cm.available,
            state: view.state,
            credit: view.credit,
            message: view.message,
            tone: view.messageTone,
            ...(view.bar ? { bar: { ...view.bar, state: view.barState } } : {}),
          },
        });
      }
    }
    return out;
  }, [model]);

  const assign = useCallback((categoryId: string, amount: Minor) => {
    setPlan((p) => {
      const ctx = { now: new Date().toISOString(), today: SAMPLE_TODAY, newId };
      return applyChanges(p, setAssigned(p, ctx, { month, categoryId, amount }).changes).plan;
    });
  }, []);

  const columns = useMemo(
    (): GridColumn<PlanRow>[] => [
      {
        id: 'category',
        header: 'Category',
        width: 260,
        flex: true,
        render: (r) =>
          r.kind === 'group' ? (
            r.data.name
          ) : (
            <span className={styles.catName}>
              <span>{r.data.name}</span>
              <span className={cx(styles.message, r.data.tone === 'warn' && styles.warn, r.data.tone === 'bad' && styles.bad)}>{r.data.message}</span>
              {r.data.bar ? <ProgressBar {...r.data.bar} /> : <span />}
            </span>
          ),
      },
      {
        id: 'assigned',
        header: 'Assigned',
        width: 140,
        align: 'end',
        editable: (r) => r.kind === 'item',
        render: (r) => formatMoney(r.data.assigned, fmt),
        editor: ({ row, seed, done }) => (
          <MoneyCellEditor value={row.data.assigned} format={fmt} seed={seed} label={`Assigned for ${row.data.name}`} done={done} onCommit={(v) => {
            assign(row.id, v);
          }} />
        ),
      },
      { id: 'activity', header: 'Activity', width: 140, align: 'end', render: (r) => formatMoney(r.data.activity, fmt) },
      {
        id: 'available',
        header: 'Available',
        width: 140,
        align: 'end',
        render: (r) =>
          r.kind === 'group' || r.data.state === undefined ? (
            formatMoney(r.data.available, fmt)
          ) : (
            <Pill state={r.data.state} credit={r.data.credit === true}>
              {formatMoney(r.data.available, fmt)}
            </Pill>
          ),
      },
    ],
    [fmt, assign],
  );

  const hidden = model.groups.filter((g) => g.group.systemKind === 'hidden').map((g) => g.group.id);
  return (
    <>
      <div className={cx(styles.frame, styles.tall)}>
        <DataGrid<PlanRow> label="Categories" rows={rows} columns={columns} density="plan" selectable defaultCollapsed={hidden} enterMoves="down" />
      </div>
      <p className={styles.echo} aria-live="polite">
        Ready to Assign: {formatMoney(model.ms.readyToAssign, fmt)}
      </p>
    </>
  );
}

// ---- section -------------------------------------------------------------------------------------

function GridSection() {
  const sample = useMemo(() => buildSamplePlan(), []);
  const link = useMemo(() => deepLink(), []);
  return (
    <>
      <Specimen label="Register (editable)">
        <div style={{ width: '100%' }}>
          <RegisterDemo plan={sample.plan} link={link} />
          <p className={styles.caption}>
            Arrows move · Enter or typing edits · Tab moves to the next field · Enter saves and moves down · Esc cancels · Ctrl+Enter saves and adds
            another · Space / Ctrl / Shift select · right-click or Shift+F10 for actions · drag a header edge to resize.
          </p>
        </div>
      </Specimen>
      <Specimen label="Plan (grouped)">
        <div style={{ width: '100%' }}>
          <PlanDemo initial={sample.plan} />
          <p className={styles.caption}>Group rows collapse with Enter, Space or Left/Right on the first column. Assigned edits recompute the plan.</p>
        </div>
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'grid', title: 'Editable grid', order: 90, Component: GridSection };
