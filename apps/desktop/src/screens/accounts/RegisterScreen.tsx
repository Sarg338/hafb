// The register (S4.5), rebuilt from the component library on the DataGrid in the approved S3.1
// look (ADR 0007). YNAB's editing model: a row is edited whole (every field at once) with Cancel /
// Save / Save and add another under it; Enter saves, Esc cancels, Tab moves between fields,
// Ctrl+Enter saves and starts another. Shortcuts follow YNAB's list: Shift+N adds, C toggles
// cleared, Shift+F then 0–6 flags, Delete deletes.
// S4.6 (YNAB, observed 2026-10-08): splits with "Amount remaining to assign"; a selection gets the
// floating action bar (Categorize, Flag, Clear, More) and a right-click menu; A approves, Shift+L
// approves all, K categorizes, S splits, Shift+D duplicates; criteria search; header sort; View
// Options (date presets, Show Reconciled, Show Flags, running balance) kept per register.
// S5.4 (YNAB, observed 2026-10-08): the "Scheduled Transactions" section lists each schedule's next
// occurrence on the section's tint; a schedule edits in the same row editor, with its repeat under
// the date picker's calendar. A new row dated after today becomes a schedule. A scheduled selection
// gets Enter Now (E), Categorize, Flag and More; Shift+T makes a transaction repeat.
// S5.6 (YNAB, observed 2026-10-08): Reconcile (Shift+E) asks "Is your current balance $X?". Yes
// locks the cleared transactions; No asks for the bank's balance, then a banner tracks the
// difference while transactions are cleared: Cancel, or Create Adjustment & Finish (Finish once
// it matches).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CASH_ACCOUNT_TYPES, type ClearedState, type FlagColor, type Frequency, type Id } from '@hafb/engine';
import { formatDate, minor, monthOf, neg, ZERO, type ISODate, type Minor } from '@hafb/shared';
import {
  addScheduled,
  addTransaction,
  applyChanges,
  approveTransactions,
  deleteScheduled,
  deleteTransactions,
  duplicateTransactions,
  editScheduled,
  editScheduledMany,
  editTransaction,
  editTransactions,
  enterDueScheduled,
  enterScheduledNow,
  makeRepeating,
  mergeChangeSets,
  planBudget,
  reconcileAccount,
  reconcilePreview,
  setCleared,
  setFlag,
  setFlagName,
  skipScheduled,
  type BulkPatch,
  type ChangeSet,
  type Command,
  type PlanData,
} from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { DEFAULT_REGISTER_VIEW, prefs, usePrefs, type RegisterViewPref } from '../../shell/prefs.ts';
import { ActionBar, ActionBarButton, ActionBarRule } from '../../ui/ActionBar.tsx';
import { Notice } from '../../ui/Banner.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { cx } from '../../ui/cx.ts';
import { DateInput } from '../../ui/DateInput.tsx';
import { Dialog, useConfirm } from '../../ui/Dialog.tsx';
import { DataGrid, type GridColumn } from '../../ui/grid/DataGrid.tsx';
import type { GridRow } from '../../ui/grid/types.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MenuList, type MenuItem } from '../../ui/Menu.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { PayeePicker } from '../../ui/PayeePicker.tsx';
import { categoryPickerData, payeeGroups } from '../../ui/pickerData.ts';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import { useShortcut } from '../../ui/shortcuts/ShortcutProvider.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { moneyFormat } from '../plan/planModel.ts';
import { moneyText } from '../shared/money.ts';
import { Pill } from '../../ui/Pill.tsx';
import { cardHeader, recordPaymentAmount } from '../shared/cardModel.ts';
import { isLoanType, typeInfo } from './accountsModel.ts';
import { LoanPanel, RecordLoanPaymentDialog } from './LoanPanel.tsx';
import { colorLabel, FLAG_COLORS, flagForDigit, flagName } from './flags.ts';
import {
  addSplitLine,
  DATE_PRESETS,
  DEFAULT_SORT,
  defaultCleared,
  draftFor,
  draftForScheduled,
  FREQUENCIES,
  frequencyLabel,
  newRowKind,
  nextSort,
  parseRegisterSearch,
  patchSplitLine,
  presetRange,
  registerCounts,
  registerRows,
  removeSplitLine,
  scheduledIdOf,
  scheduledRows,
  selectedTotal,
  splitRemaining,
  startSplit,
  toInput,
  toPatch,
  toScheduledInput,
  transferNeedsCategory,
  type MonthRange,
  type RegisterRow,
  type RegisterSort,
  type ScheduledRow,
  type SortColumn,
  type SplitLineDraft,
  type TxDraft,
} from './registerModel.ts';
import { ViewOptions } from './ViewOptions.tsx';
import styles from './RegisterScreen.module.css';

const NEW = '__new__';
/** The typed name of a payee that the save will create. */
const NEW_PAYEE = '__new-payee__';
const SCHEDULED = '__scheduled__';
const STRIP_HEIGHT = 42;
const SPLIT_LINE_HEIGHT = 26;
/** A split line being edited, and the "Add another split" line under them. */
const EDIT_LINE_HEIGHT = 34;
/** The category picker's last option starts a split (YNAB's Split button). */
const SPLIT = '__split__';
const SORTABLE: readonly SortColumn[] = ['account', 'date', 'payee', 'category', 'memo', 'outflow', 'inflow'];
const isSortable = (id: string): id is SortColumn => SORTABLE.some((c) => c === id);
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthShort = (m: string): string => MONTH_SHORT[Number(m.slice(5, 7)) - 1] ?? m;
const plural = (n: number): string => `${String(n)} Transaction${n === 1 ? '' : 's'}`;

/** The View Options date range: a preset's months, the custom From/To, or all dates. */
function viewRange(view: RegisterViewPref, today: ISODate): MonthRange | null {
  const preset = DATE_PRESETS.find((x) => x.id === view.preset);
  if (preset) return presetRange(preset.id, today);
  return view.from !== undefined && view.to !== undefined ? { from: view.from, to: view.to } : null;
}

type Row = { kind: 'tx'; tx: RegisterRow; scheduled?: ScheduledRow } | { kind: 'new' } | { kind: 'scheduled'; count: number };

/** A selection split into transactions and schedules (their row ids carry a prefix). */
function splitIds(ids: readonly string[]): { tx: string[]; sched: string[] } {
  const tx: string[] = [];
  const sched: string[] = [];
  for (const id of ids) {
    const s = scheduledIdOf(id);
    if (s === null) tx.push(id);
    else sched.push(s);
  }
  return { tx, sched };
}

/** Commands on the evolving plan, as one change set (one undo step). */
function chained(plan: PlanData, label: string, steps: readonly ((p: PlanData) => Command | null)[]): Command {
  let current = plan;
  const sets: ChangeSet[] = [];
  let last = label;
  for (const step of steps) {
    const cmd = step(current);
    if (!cmd) continue;
    current = applyChanges(current, cmd.changes).plan;
    sets.push(cmd.changes);
    last = cmd.label;
  }
  return { label: sets.length === 1 ? last : label, changes: mergeChangeSets(...sets) };
}

const NEXT_CLEARED: Record<ClearedState, ClearedState> = { uncleared: 'cleared', cleared: 'uncleared', reconciled: 'reconciled' };

export interface RegisterScreenProps {
  plan: PlanData;
  today: ISODate;
  accountId: Id | null;
  actions: Actions;
  history: { canUndo: boolean; canRedo: boolean; undoLabel: string | undefined; redoLabel: string | undefined };
  /** Open with this transaction selected and in view (Reflect drill-down). */
  focusTransactionId?: string;
}

export function RegisterScreen({ plan, today, accountId, actions, history, focusTransactionId }: RegisterScreenProps) {
  const p = usePrefs();
  const fmt = moneyFormat(plan);
  const money = useMemo(() => moneyText(fmt, p.hideAmounts), [fmt, p.hideAmounts]);
  const account = accountId === null ? undefined : plan.accounts.find((a) => a.id === accountId);
  const budget = useMemo(() => planBudget(plan, { today }), [plan, today]);
  const balances = budget.accountBalances;
  // A credit card's header pills and Record Payment (S4.7, YNAB trial 2026-10-08).
  const card = useMemo(() => (accountId === null ? null : cardHeader(plan, budget, accountId)), [plan, budget, accountId]);
  const [searchText, setSearchText] = useState('');
  const [onlyUnapproved, setOnlyUnapproved] = useState(false);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [sort, setSort] = useState<RegisterSort>(DEFAULT_SORT);
  const [viewOpen, setViewOpen] = useState(false);
  const viewButton = useRef<HTMLButtonElement>(null);
  const [categorizeFor, setCategorizeFor] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [moveFor, setMoveFor] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [moreFor, setMoreFor] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [memoFor, setMemoFor] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [edit, setEdit] = useState<{ id: string; focus: string } | null>(null);
  const [draft, setDraftState] = useState<TxDraft | null>(null);
  const draftRef = useRef<TxDraft | null>(null);
  const [request, setRequest] = useState<{ cell: { rowId: string; columnId: string }; edit: boolean; key: number } | undefined>(undefined);
  const [flagMenu, setFlagMenu] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [renamingFlags, setRenamingFlags] = useState(false);
  const [loanPayment, setLoanPayment] = useState(false);
  const [repeatFor, setRepeatFor] = useState<{ id: string; at: Rect } | null>(null);
  const [reconcile, setReconcile] = useState<null | { step: 'ask' } | { step: 'enter'; amount: Minor } | { step: 'mode'; statement: Minor }>(null);
  const reconcileButton = useRef<HTMLButtonElement>(null);
  const confirm = useConfirm();
  const reconcileAmount = useRef<Minor>(ZERO);
  const bankField = useRef<HTMLInputElement>(null);
  // "Current balance at your bank" starts empty and focused (YNAB).
  const reconcileStep = reconcile?.step;
  useEffect(() => {
    if (reconcileStep !== 'enter') return;
    const id = requestAnimationFrame(() => {
      bankField.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [reconcileStep]);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewKey = accountId ?? 'all';
  const view = p.registerViews[viewKey] ?? DEFAULT_REGISTER_VIEW;
  const range = viewRange(view, today);
  const showBalance = accountId !== null && view.runningBalance;
  const search = useMemo(() => parseRegisterSearch(plan, searchText), [plan, searchText]);
  const searching = search.query !== null;

  const setDraft = useCallback((d: TxDraft | null) => {
    draftRef.current = d;
    setDraftState(d);
  }, []);
  const patchDraft = useCallback(
    (patch: Partial<TxDraft>) => {
      const current = draftRef.current;
      if (current) setDraft({ ...current, ...patch });
    },
    [setDraft],
  );

  // A different account is a different register: the shell remounts this screen per account.

  // Opened on one transaction (a Reflect drill-down): show every date until View Options change,
  // so the transaction is there even when the saved view would hide it.
  const [reveal, setReveal] = useState(focusTransactionId !== undefined);
  // A new transaction to open on: select it and bring it into view (state adjusted during render,
  // React's pattern for following a prop).
  const [focused, setFocused] = useState<string | undefined>(undefined);
  if (focusTransactionId !== focused) {
    setFocused(focusTransactionId);
    if (focusTransactionId !== undefined) {
      setReveal(true);
      setSelected(new Set([focusTransactionId]));
      setRequest((r) => ({ cell: { rowId: focusTransactionId, columnId: 'payee' }, edit: false, key: (r?.key ?? 0) + 1 }));
    }
  }
  const txRows = useMemo(
    () => registerRows(plan, { accountId, search: search.query, onlyUnapproved, onlyUncategorized, range: reveal ? null : range, showReconciled: reveal || view.showReconciled, sort }),
    // `range` is derived from view and today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, accountId, search.query, onlyUnapproved, onlyUncategorized, view, today, sort, reveal],
  );
  const byId = useMemo(() => new Map(plan.transactions.map((t) => [t.id, t])), [plan.transactions]);
  const unapproved = useMemo(() => plan.transactions.filter((t) => t.deletedAt === undefined && t.approved === false && (accountId === null || t.accountId === accountId)), [plan.transactions, accountId]);
  const counts = useMemo(() => registerCounts(plan, accountId), [plan, accountId]);
  // The selection, limited to rows still shown (a filter or a delete can hide selected rows).
  const schedRows = useMemo(() => (searching ? [] : scheduledRows(plan, accountId)), [plan, accountId, searching]);
  const schedById = useMemo(() => new Map(plan.scheduled.map((x) => [x.id, x])), [plan.scheduled]);
  const shown = useMemo(() => new Set([...schedRows.map((r) => r.id), ...txRows.map((r) => r.id)]), [schedRows, txRows]);
  const picked = useMemo(() => [...selected].filter((id) => shown.has(id)), [selected, shown]);
  const firstMonth = useMemo(() => {
    let min = monthOf(today);
    for (const t of plan.transactions) if (t.deletedAt === undefined && monthOf(t.date) < min) min = monthOf(t.date);
    return min;
  }, [plan.transactions, today]);
  const scheduledCount = schedRows.length;

  const rows = useMemo((): GridRow<Row>[] => {
    // A search hides the Scheduled section (YNAB).
    const out: GridRow<Row>[] = searching ? [] : [{ kind: 'group', id: SCHEDULED, data: { kind: 'scheduled', count: scheduledCount } }];
    for (const sr of schedRows) out.push({ kind: 'item', id: sr.id, groupId: SCHEDULED, data: { kind: 'tx', tx: sr, scheduled: sr } });
    if (edit?.id === NEW) out.push({ kind: 'item', id: NEW, data: { kind: 'new' } });
    for (const tx of txRows) out.push({ kind: 'item', id: tx.id, data: { kind: 'tx', tx } });
    return out;
  }, [txRows, schedRows, edit?.id, scheduledCount, searching]);

  // ---- editing ---------------------------------------------------------------------------------
  const openAccounts = useMemo(() => plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true).toSorted((a, b) => a.sortOrder - b.sortOrder), [plan.accounts]);
  const firstAccount = accountId ?? openAccounts.find((a) => a.onBudget)?.id ?? openAccounts[0]?.id ?? '';

  const startNew = useCallback(
    (from?: Partial<TxDraft>) => {
      const acct = from?.accountId ?? firstAccount;
      if (acct === '') {
        actions.notify('Add an account first: transactions belong to an account.');
        return;
      }
      setSelected(new Set());
      setDraft({ ...draftFor(null, { accountId: acct, date: from?.date ?? today, cleared: defaultCleared(plan, acct) }), ...(from?.inflow === undefined ? {} : { inflow: from.inflow }) });
      setEdit({ id: NEW, focus: accountId === null ? 'account' : 'date' });
    },
    [firstAccount, today, plan, accountId, actions, setDraft],
  );

  const startEdit = useCallback(
    (id: string, focus = 'payee', split = false) => {
      const sid = scheduledIdOf(id);
      const s = sid === null ? undefined : schedById.get(sid);
      if (s) {
        const d = draftForScheduled(s);
        setSelected(new Set([id]));
        setDraft(split ? startSplit(d) : d);
        setEdit({ id, focus: split && d.splits === null ? 'line-1:payee' : focus });
        return;
      }
      const t = byId.get(id);
      if (!t) return;
      if (t.cleared === 'reconciled') actions.notify('This transaction is reconciled. Changing it can make the account disagree with your bank.');
      const d = draftFor(t, { accountId: t.accountId, date: t.date });
      if (split && t.transferTransactionId !== undefined && t.subtransactions === undefined && t.transferAccountId === undefined) {
        actions.notify('This transfer comes from a split; edit it in the split.');
        return;
      }
      setSelected(new Set([id]));
      setDraft(split ? startSplit(d) : d);
      setEdit({ id, focus: split && d.splits === null ? 'line-1:payee' : focus });
    },
    [byId, schedById, actions, setDraft],
  );

  const cancel = useCallback(() => {
    const id = edit?.id;
    setEdit(null);
    setDraft(null);
    if (id !== undefined && id !== NEW) setRequest((r) => ({ cell: { rowId: id, columnId: 'payee' }, edit: false, key: (r?.key ?? 0) + 1 }));
  }, [edit, setDraft]);

  const save = useCallback(
    (andAnother: boolean) => {
      const d = draftRef.current;
      if (!edit || !d) return;
      const remaining = d.splits === null ? 0 : splitRemaining(d);
      if (remaining !== 0) {
        actions.notify(`Assign the remaining ${money(remaining < 0 ? neg(remaining) : remaining)} to a split line, or change the amount.`);
        return;
      }
      if (edit.id === NEW) {
        if (d.inflow === 0 && d.outflow === 0 && d.payeeId === null && d.payeeName.trim() === '' && d.transferAccountId === null && d.memo.trim() === '' && d.categoryId === null) {
          cancel();
          return;
        }
        const kind = newRowKind(d, today);
        if (kind === 'scheduled') actions.run((pl, ctx) => addScheduled(pl, ctx, toScheduledInput(pl, d)));
        else if (kind === 'transactionAndRepeat') {
          actions.run((pl, ctx) => {
            const add = addTransaction(pl, ctx, toInput(pl, d));
            const next = applyChanges(pl, add.changes).plan;
            const repeat = makeRepeating(next, ctx, { transactionId: add.transactionId, frequency: d.frequency ?? 'monthly' });
            return { label: add.label, changes: mergeChangeSets(add.changes, repeat.changes) };
          });
        } else actions.run((pl, ctx) => addTransaction(pl, ctx, toInput(pl, d)));
      } else if (scheduledIdOf(edit.id) !== null) {
        const sid = scheduledIdOf(edit.id) ?? '';
        // A schedule moved to today or earlier is entered now, as on its date (§5.11).
        actions.run((pl, ctx) =>
          chained(pl, 'Edit scheduled transaction', [
            (p) => editScheduled(p, ctx, { scheduledId: sid, input: toScheduledInput(p, d) }),
            (p) => (d.date <= ctx.today ? enterDueScheduled(p, ctx) : null),
          ]),
        );
      } else {
        const t = byId.get(edit.id);
        if (t) {
          const patch = toPatch(plan, t, d);
          if (Object.keys(patch).length > 0) actions.run((pl, ctx) => editTransaction(pl, ctx, { transactionId: t.id, patch }));
        }
      }
      if (andAnother) {
        startNew({ accountId: d.accountId, date: d.date });
      } else {
        const id = edit.id;
        setEdit(null);
        setDraft(null);
        if (id !== NEW) setRequest((r) => ({ cell: { rowId: id, columnId: 'payee' }, edit: false, key: (r?.key ?? 0) + 1 }));
      }
    },
    [edit, byId, plan, actions, startNew, cancel, setDraft, money, today],
  );

  // Keys inside the row being edited: Enter saves (unless a picker's list is open or a field is
  // invalid), Ctrl+Enter saves and adds another, Esc cancels.
  const onEditKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!edit || !(e.target instanceof HTMLElement) || !e.target.closest('[data-row-editor]')) return;
    const t = e.target;
    if (e.key === 'Enter') {
      if (t.getAttribute('role') === 'combobox' && t.getAttribute('aria-expanded') === 'true') return;
      if (t.getAttribute('aria-invalid') === 'true') return;
      if (t instanceof HTMLButtonElement) return;
      e.preventDefault();
      // Let the field commit (it handles Enter first), then save from the updated draft.
      queueMicrotask(() => {
        save(e.ctrlKey || e.metaKey);
      });
    } else if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      cancel();
    }
  };

  // Navigation keys on a focused row (not editing): Enter edits, Esc deselects.
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (edit) return;
    if (!(e.target instanceof HTMLElement) || !e.target.matches('[data-cell]')) return;
    const rowId = e.target.dataset.row;
    const col = e.target.dataset.col;
    if (e.key === 'Enter' && rowId !== undefined && rowId !== SCHEDULED && !e.ctrlKey) {
      e.preventDefault();
      startEdit(rowId, col === undefined || col === '__select__' ? 'payee' : col);
    } else if (e.key === 'Escape' && selected.size > 0) {
      e.preventDefault();
      setSelected(new Set());
    }
  };

  // ---- actions on rows ---------------------------------------------------------------------------
  const targetIds = useCallback((rowId?: string): string[] => {
    if (picked.length > 0 && (rowId === undefined || picked.includes(rowId))) return picked;
    return rowId === undefined ? [] : [rowId];
  }, [picked]);
  const activeRowId = (): string | undefined => {
    const el = document.activeElement;
    return el instanceof HTMLElement ? el.closest<HTMLElement>('[data-row-id]')?.dataset.rowId : undefined;
  };

  const toggleCleared = useCallback(
    (ids: string[]) => {
      const live = ids.map((id) => byId.get(id)).filter((t) => t !== undefined && t.cleared !== 'reconciled');
      if (live.length === 0) return;
      // YNAB: if any is uncleared, clear them all; otherwise unclear them.
      const to: ClearedState = live.some((t) => t?.cleared === 'uncleared') ? 'cleared' : 'uncleared';
      actions.run((pl, ctx) => setCleared(pl, ctx, { transactionIds: live.map((t) => t?.id ?? ''), cleared: to }));
    },
    [byId, actions],
  );
  const applyFlag = useCallback(
    (ids: string[], flag: FlagColor | null) => {
      const { tx, sched } = splitIds(ids);
      if (ids.length === 0) return;
      actions.run((pl, ctx) =>
        chained(pl, flag === null ? 'Clear flags' : 'Flag', [
          (p) => (tx.length > 0 ? setFlag(p, ctx, { transactionIds: tx, flag }) : null),
          (p) => (sched.length > 0 ? editScheduledMany(p, ctx, { scheduledIds: sched, patch: { flag } }) : null),
        ]),
      );
    },
    [actions],
  );
  const setClearedTo = useCallback(
    (ids: string[], to: ClearedState) => {
      const live = ids.filter((id) => byId.get(id)?.cleared !== 'reconciled');
      if (live.length > 0) actions.run((pl, ctx) => setCleared(pl, ctx, { transactionIds: live, cleared: to }));
    },
    [byId, actions],
  );
  const approve = useCallback(
    (ids: string[]) => {
      const todo = ids.filter((id) => byId.get(id)?.approved === false);
      if (todo.length > 0) actions.run((pl, ctx) => approveTransactions(pl, ctx, { transactionIds: todo }));
    },
    [byId, actions],
  );
  const bulk = useCallback(
    (ids: string[], patch: BulkPatch, announce?: string) => {
      const { tx, sched } = splitIds(ids);
      // Schedules take Categorize and Memo; moving accounts is for transactions.
      const schedPatch = { ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }), ...(patch.memo === undefined ? {} : { memo: patch.memo }) };
      const forSched = patch.accountId === undefined && Object.keys(schedPatch).length > 0 ? sched : [];
      if (tx.length === 0 && forSched.length === 0) return;
      actions.run(
        (pl, ctx) =>
          chained(pl, `Edit ${plural(tx.length + forSched.length).toLowerCase()}`, [
            (p) => (tx.length > 0 ? editTransactions(p, ctx, { transactionIds: tx, patch }) : null),
            (p) => (forSched.length > 0 ? editScheduledMany(p, ctx, { scheduledIds: forSched, patch: schedPatch }) : null),
          ]),
        announce === undefined ? {} : { announce },
      );
    },
    [actions],
  );
  const enterNow = useCallback(
    (ids: string[]) => {
      const { sched } = splitIds(ids);
      if (sched.length === 0) return;
      actions.run((pl, ctx) => enterScheduledNow(pl, ctx, { scheduledIds: sched }), { announce: sched.length === 1 ? 'Entered the scheduled transaction.' : `Entered ${String(sched.length)} scheduled transactions.` });
      setSelected(new Set());
    },
    [actions],
  );
  const skip = useCallback(
    (ids: string[]) => {
      const { sched } = splitIds(ids);
      if (sched.length > 0) actions.run((pl, ctx) => skipScheduled(pl, ctx, { scheduledIds: sched }), { announce: sched.length === 1 ? 'Skipped the next occurrence.' : `Skipped ${String(sched.length)} occurrences.` });
    },
    [actions],
  );
  const repeat = useCallback(
    (id: string, frequency: Frequency) => {
      actions.run((pl, ctx) => makeRepeating(pl, ctx, { transactionId: id, frequency }), { announce: `Repeats ${frequencyLabel(frequency).toLowerCase()}; it’s in Scheduled Transactions.` });
    },
    [actions],
  );
  const duplicate = useCallback(
    (all: string[]) => {
      const ids = splitIds(all).tx;
      if (ids.length === 0) return;
      let created: string[] = [];
      actions.run((pl, ctx) => {
        const cmd = duplicateTransactions(pl, ctx, { transactionIds: ids });
        created = cmd.transactionIds;
        return cmd;
      });
      // YNAB selects the copies.
      if (created.length > 0) setSelected(new Set(created));
    },
    [actions],
  );
  /** Where a keyboard-opened popover hangs: the focused row, else the middle of the register. */
  const anchorFor = (rowId: string | undefined): Rect => {
    const el = rowId === undefined ? null : document.querySelector<HTMLElement>(`[role=row][data-row-id="${CSS.escape(rowId)}"] [data-col=category]`);
    const r = el?.getBoundingClientRect();
    return r ? { top: r.bottom, left: r.left, width: r.width, height: 0 } : { top: window.innerHeight / 3, left: window.innerWidth / 2 - 140, width: 0, height: 0 };
  };

  const remove = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const { tx, sched } = splitIds(ids);
      const what = tx.length === 0 ? (sched.length === 1 ? 'the scheduled transaction' : `${String(sched.length)} scheduled transactions`) : ids.length === 1 ? 'the transaction' : `${String(ids.length)} transactions`;
      actions.run(
        (pl, ctx) =>
          chained(pl, `Delete ${plural(ids.length).toLowerCase()}`, [
            (p) => (tx.length > 0 ? deleteTransactions(p, ctx, { transactionIds: tx }) : null),
            (p) => (sched.length > 0 ? deleteScheduled(p, ctx, { scheduledIds: sched }) : null),
          ]),
        { announce: `Deleted ${what}.` },
      );
      setSelected(new Set());
    },
    [actions],
  );

  // Shortcuts (YNAB's list). Shift+F waits for a digit: 1–6 a colour, 0 clears.
  const flagPending = useRef<number>(0);
  const clickEdits = useRef<string | null>(null);
  useShortcut({ id: 'register.add', keys: 'Shift+N', description: 'Add a new transaction', group: 'Register', scope: 'screen', run: () => { startNew(); } });
  useShortcut({ id: 'register.toggleCleared', keys: 'C', description: 'Toggle cleared for the selection', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { toggleCleared(targetIds(activeRowId())); } });
  useShortcut({ id: 'register.flag', keys: 'Shift+F', description: 'Flag (then 1–6 for a colour, 0 to clear)', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { flagPending.current = performance.now(); } });
  useShortcut({ id: 'register.delete', keys: 'Delete', description: 'Delete', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { remove(targetIds(activeRowId())); } });
  useShortcut({ id: 'register.approve', keys: 'A', description: 'Approve', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { approve(targetIds(activeRowId())); } });
  useShortcut({ id: 'register.approveAll', keys: 'Shift+L', description: 'Approve all transactions', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { approve(unapproved.map((t) => t.id)); } });
  useShortcut({
    id: 'register.categorize',
    keys: 'K',
    description: 'Categorize',
    group: 'Register',
    scope: 'screen',
    enabled: edit === null,
    run: () => {
      const row = activeRowId();
      const ids = targetIds(row);
      if (ids.length > 0) setCategorizeFor({ ids, at: anchorFor(row ?? ids[0]) });
    },
  });
  useShortcut({
    id: 'register.split',
    keys: 'S',
    description: 'Split',
    group: 'Register',
    scope: 'screen',
    enabled: edit === null,
    run: () => {
      const ids = targetIds(activeRowId());
      if (ids.length === 1 && ids[0] !== undefined) startEdit(ids[0], 'payee', true);
    },
  });
  useShortcut({
    id: 'register.reconcile',
    keys: 'Shift+E',
    description: 'Reconcile the account',
    group: 'Register',
    scope: 'screen',
    enabled: edit === null && account !== undefined && account.closed !== true,
    run: () => {
      setReconcile({ step: 'ask' });
    },
  });
  useShortcut({ id: 'register.enterNow', keys: 'E', description: 'Enter a scheduled transaction now', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { enterNow(targetIds(activeRowId())); } });
  useShortcut({
    id: 'register.repeat',
    keys: 'Shift+T',
    description: 'Make repeating',
    group: 'Register',
    scope: 'screen',
    enabled: edit === null,
    run: () => {
      const row = activeRowId();
      const ids = splitIds(targetIds(row)).tx;
      if (ids.length === 1 && ids[0] !== undefined) setRepeatFor({ id: ids[0], at: anchorFor(ids[0]) });
    },
  });
  useShortcut({ id: 'register.duplicate', keys: 'Shift+D', description: 'Duplicate', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { duplicate(targetIds(activeRowId())); } });
  useShortcut({ id: 'register.search', keys: 'Ctrl+Shift+F', description: 'Focus the search bar', group: 'Register', scope: 'screen', allowInInputs: true, run: () => { searchRef.current?.focus(); } });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (flagPending.current === 0 || performance.now() - flagPending.current > 1500) return;
      const flag = flagForDigit(e.key);
      flagPending.current = 0;
      if (flag === undefined) return;
      e.preventDefault();
      applyFlag(targetIds(activeRowId()), flag);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [applyFlag, targetIds]);

  // ---- columns -----------------------------------------------------------------------------------
  const draftAccountId = draft?.accountId;
  const draftMonth = monthOf(draft?.date ?? today);
  const draftPayeeId = draft?.payeeId ?? null;
  const payees = useMemo(() => payeeGroups(plan, { keep: draftPayeeId, ...(draftAccountId === undefined ? {} : { excludeAccountId: draftAccountId }) }), [plan, draftAccountId, draftPayeeId]);
  const categories = useMemo(() => categoryPickerData(plan, draftMonth, today), [plan, draftMonth, today]);
  const payeeById = useMemo(() => new Map(plan.payees.map((x) => [x.id, x])), [plan.payees]);
  const isEditing = (r: GridRow<Row>): boolean => edit !== null && r.id === edit.id;
  const draftAccount = draft ? plan.accounts.find((a) => a.id === draft.accountId) : undefined;
  const categoryDisabled = draft !== null && (draftAccount?.onBudget !== true || (draft.transferAccountId !== null && !transferNeedsCategory(plan, draft.accountId, draft.transferAccountId)));
  // The parent's picker ends with "Split (Multiple Categories)…" (YNAB's Split button).
  const parentCategories = useMemo(() => [...categories.groups, { id: 'split', label: 'Split', options: [{ id: SPLIT, label: 'Split (Multiple Categories)…', keywords: ['split'] }] }], [categories.groups]);

  const autoFocus = (col: string): boolean => edit?.focus === col;
  // Starting a split lands on the first line's payee. The lines mount under the row (rowExtra), after
  // the grid has settled focus on the row, so focus them once both have rendered.
  const splitFocus = edit?.focus.startsWith('line-1:') === true ? edit.focus : null;
  useEffect(() => {
    if (splitFocus === null) return;
    const id = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-split-line="1"] [role=combobox]')?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [splitFocus]);
  const editor = (col: string, node: ReactNode): ReactNode => (
    <div className={styles.field} data-row-editor="" data-field={col}>
      {node}
    </div>
  );

  const columns = useMemo((): GridColumn<Row>[] => {
    const cols: GridColumn<Row>[] = [];
    // Show Flags off hides the column, except for the Scheduled header that draws there.
    cols.push(
      {
        id: 'flag',
        header: 'Flag',
        headerHidden: true,
        headerIcon: 'flag',
        width: 34,
        align: 'center',
        resizable: false,
        render: (r) => {
          if (r.data.kind === 'scheduled') {
            return (
              <span className={styles.schedLabel}>
                <Icon name="calendarClock" /> Scheduled Transactions <span className={styles.muted}>({r.data.count})</span>
              </span>
            );
          }
          if (r.data.kind !== 'tx') return null;
          const tx = r.data.tx;
          return (
            <button
              type="button"
              data-interactive=""
              className={cx(styles.flag, tx.flag !== undefined && styles.flagOn)}
              style={tx.flag ? { color: `var(--c-flag-${tx.flag})` } : undefined}
              aria-label={tx.flag ? `Flag: ${flagName(plan, tx.flag)}. Change flag` : 'Add a flag'}
              title={tx.flag ? flagName(plan, tx.flag) : 'Flag'}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setFlagMenu({ ids: targetIds(tx.id), at: { top: rect.bottom, left: rect.left, width: rect.width, height: 0 } });
              }}
            >
              <Icon name="flag" />
            </button>
          );
        },
      },
    );
    if (accountId === null) {
      cols.push({
        id: 'account',
        header: 'Account',
        width: 148,
        render: (r) =>
          isEditing(r) && draft
            ? editor(
                'account',
                <Combobox
                  label="Account"
                  placeholder="Account"
                  size="compact"
                  groups={[{ id: 'accounts', label: 'Accounts', options: openAccounts.map((a) => ({ id: a.id, label: a.name })) }]}
                  value={draft.accountId}
                  autoFocus={autoFocus('account')}
                  onChange={(id) => {
                    patchDraft({ accountId: id, cleared: edit?.id === NEW ? defaultCleared(plan, id) : draft.cleared, ...(draft.transferAccountId === id ? { transferAccountId: null } : {}) });
                  }}
                />,
              )
            : r.data.kind === 'tx'
              ? r.data.tx.accountName
              : '',
      });
    }
    cols.push(
      {
        id: 'date',
        header: 'Date',
        width: 116,
        render: (r) =>
          isEditing(r) && draft
            ? editor(
                'date',
                <DateInput
                  label="Date"
                  hideLabel
                  size="compact"
                  value={draft.date}
                  format={plan.settings.dateFormat}
                  today={today}
                  calendarTabStop={false}
                  onCommit={(date) => { patchDraft({ date }); }}
                  autoFocus={autoFocus('date')}
                  calendarFooter={
                    edit?.id === NEW || scheduledIdOf(edit?.id ?? '') !== null ? (
                      <div className={styles.repeat}>
                        <Combobox
                          label="Repeat"
                          size="compact"
                          groups={[{ id: 'repeat', label: 'Repeat', options: FREQUENCIES.map((f) => ({ id: f.id, label: f.label })) }]}
                          value={draft.frequency ?? 'never'}
                          onChange={(id) => {
                            const f = FREQUENCIES.find((x) => x.id === id);
                            if (f) patchDraft({ frequency: f.id });
                          }}
                        />
                      </div>
                    ) : undefined
                  }
                />,
              )
            : r.data.kind === 'tx'
              ? <span className={styles.date}>{formatDate(r.data.tx.date, plan.settings.dateFormat)}</span>
              : '',
      },
      {
        id: 'payee',
        header: 'Payee',
        width: 188,
        render: (r) => {
          if (isEditing(r) && draft) {
            const transferPayee = draft.transferAccountId === null ? null : (plan.payees.find((x) => x.transferAccountId === draft.transferAccountId)?.id ?? null);
            return editor(
              'payee',
              <PayeePicker
                groups={draft.payeeName === '' ? payees : [...payees, { id: 'new', label: 'New payee', options: [{ id: NEW_PAYEE, label: draft.payeeName }] }]}
                size="compact"
                value={transferPayee ?? (draft.payeeName === '' ? draft.payeeId : NEW_PAYEE)}
                autoFocus={autoFocus('payee')}
                {...(actions.managePayees ? { onManage: actions.managePayees } : {})}
                onChange={(id) => {
                  if (id === NEW_PAYEE) return;
                  const payee = payeeById.get(id);
                  if (payee?.transferAccountId !== undefined) {
                    patchDraft({ transferAccountId: payee.transferAccountId, payeeId: null, payeeName: '' });
                  } else {
                    // A payee's default category fills an empty category (§5.13).
                    const fill = draft.categoryId === null && payee?.defaultCategoryId !== undefined && payee.defaultCategoryId !== null ? { categoryId: payee.defaultCategoryId } : {};
                    patchDraft({ payeeId: id, payeeName: '', transferAccountId: null, ...fill });
                  }
                }}
                onCreate={(name) => {
                  patchDraft({ payeeId: null, payeeName: name, transferAccountId: null });
                }}
              />,
            );
          }
          if (r.data.kind !== 'tx') return '';
          const tx = r.data.tx;
          return (
            <span className={styles.payee}>
              {!tx.approved && <span className={styles.dot} title="Needs approval" />}
              {tx.transfer && <Icon name="transfer" className={styles.muted} />}
              <span className={styles.ellipsis}>{tx.payee}</span>
            </span>
          );
        },
      },
      {
        id: 'category',
        header: 'Category',
        width: 170,
        render: (r) => {
          if (isEditing(r) && draft) {
            if (draft.splits !== null) return editor('category', <span className={cx(styles.muted, styles.ellipsis)}><Icon name="split" className={styles.inline} />Split (Multiple Categories)…</span>);
            if (categoryDisabled) return editor('category', <span className={cx(styles.muted, styles.ellipsis)}>Category not needed</span>);
            return editor(
              'category',
              <CategoryPicker
                groups={draftAccount?.onBudget === true ? parentCategories : categories.groups}
                available={categories.available}
                format={fmt}
                size="compact"
                value={draft.categoryId}
                autoFocus={autoFocus('category')}
                onChange={(id) => {
                  if (id === SPLIT) {
                    const current = draftRef.current;
                    if (current) {
                      setDraft(startSplit(current));
                      setEdit((e) => (e ? { ...e, focus: 'line-1:payee' } : e));
                    }
                  } else {
                    patchDraft({ categoryId: id });
                  }
                }}
              />,
            );
          }
          if (r.data.kind !== 'tx') return '';
          const c = r.data.tx.category;
          return (
            <span className={cx(styles.ellipsis, c.tone === 'muted' && styles.muted, c.tone === 'warn' && styles.warn)}>
              {r.data.tx.splits.length > 0 && <Icon name="split" className={styles.inline} />}
              {c.text}
            </span>
          );
        },
      },
      {
        id: 'memo',
        header: 'Memo',
        width: 120,
        flex: true,
        render: (r) =>
          isEditing(r) && draft
            ? editor(
                'memo',
                <TextInput
                  label="Memo"
                  hideLabel
                  size="compact"
                  placeholder="Memo"
                  value={draft.memo}
                  autoFocus={autoFocus('memo')}
                  onChange={(e) => {
                    patchDraft({ memo: e.target.value });
                  }}
                />,
              )
            : r.data.kind === 'tx'
              ? <span className={cx(styles.ellipsis, styles.muted)}>{r.data.tx.memo}</span>
              : '',
      },
      {
        id: 'outflow',
        header: 'Outflow',
        width: 104,
        align: 'end',
        render: (r) =>
          isEditing(r) && draft
            ? editor(
                'outflow',
                <MoneyInput
                  label="Outflow"
                  hideLabel
                  variant="field"
                  size="compact"
                  value={draft.outflow}
                  format={fmt}
                  onCommit={(v) => {
                    patchDraft(v > 0 ? { outflow: v, inflow: ZERO } : { outflow: v });
                  }}
                  onEnter={() => undefined}
                />,
              )
            : r.data.kind === 'tx' && r.data.tx.amount < 0
              ? money(neg(r.data.tx.amount))
              : '',
      },
      {
        id: 'inflow',
        header: 'Inflow',
        width: 104,
        align: 'end',
        render: (r) =>
          isEditing(r) && draft
            ? editor(
                'inflow',
                <MoneyInput
                  label="Inflow"
                  hideLabel
                  variant="field"
                  size="compact"
                  value={draft.inflow}
                  format={fmt}
                  onCommit={(v) => {
                    patchDraft(v > 0 ? { inflow: v, outflow: ZERO } : { inflow: v });
                  }}
                  onEnter={() => undefined}
                />,
              )
            : r.data.kind === 'tx' && r.data.tx.amount > 0
              ? money(r.data.tx.amount)
              : '',
      },
    );
    if (showBalance) {
      cols.push({
        id: 'balance',
        header: 'Balance',
        width: 112,
        align: 'end',
        render: (r) => (r.data.kind === 'tx' && r.data.tx.balance !== undefined ? <span className={cx(r.data.tx.balance < 0 && account !== undefined && CASH_ACCOUNT_TYPES.includes(account.type) && styles.negative)}>{money(r.data.tx.balance)}</span> : ''),
      });
    }
    cols.push({
      id: 'cleared',
      header: 'Cleared',
      headerHidden: true,
      headerIcon: 'cleared',
      width: 44,
      align: 'center',
      resizable: false,
      render: (r) => {
        const sched = r.data.kind === 'tx' ? r.data.scheduled : undefined;
        if (sched) {
          const f = isEditing(r) && draft?.frequency !== undefined ? draft.frequency : sched.frequency;
          return (
            <span className={styles.repeatIcon} title={f === 'never' ? 'Scheduled once' : `Repeats ${frequencyLabel(f).toLowerCase()}`} aria-label={f === 'never' ? 'Scheduled once' : `Repeats ${frequencyLabel(f).toLowerCase()}`}>
              <Icon name={f === 'never' ? 'calendarClock' : 'sync'} />
            </span>
          );
        }
        const state: ClearedState | undefined = isEditing(r) && draft ? draft.cleared : r.data.kind === 'tx' ? r.data.tx.cleared : undefined;
        if (state === undefined) return null;
        const label = state === 'reconciled' ? 'Reconciled' : state === 'cleared' ? 'Cleared' : 'Uncleared';
        return (
          <button
            type="button"
            data-interactive=""
            data-row-editor={isEditing(r) ? '' : undefined}
            className={cx(styles.cleared, state === 'cleared' && styles.isCleared, state === 'reconciled' && styles.isReconciled)}
            aria-label={state === 'reconciled' ? 'Reconciled. Unlock' : `${label}. Toggle cleared`}
            title={state === 'reconciled' ? 'Reconciled: click to unlock' : label}
            onClick={() => {
              if (state === 'reconciled') {
                // §5.8: unlocking warns, and unlocks only this transaction (it becomes cleared).
                if (r.data.kind !== 'tx') return;
                const id = r.data.tx.id;
                void confirm({
                  title: 'Unlock this transaction?',
                  body: 'It was reconciled with your bank. Changing it can make the account disagree with your statement. It will be marked cleared.',
                  confirmLabel: 'Unlock',
                }).then((ok) => {
                  if (ok) actions.run((pl, ctx) => setCleared(pl, ctx, { transactionIds: [id], cleared: 'cleared' }));
                });
              } else if (isEditing(r)) patchDraft({ cleared: NEXT_CLEARED[state] });
              else if (r.data.kind === 'tx') toggleCleared([r.data.tx.id]);
            }}
          >
            <Icon name={state === 'reconciled' ? 'lock' : state === 'cleared' ? 'cleared' : 'uncleared'} />
          </button>
        );
      },
    });
    const visible = view.showFlags || scheduledCount > 0 ? cols : cols.filter((c) => c.id !== 'flag');
    return visible.map((c) => (isSortable(c.id) ? { ...c, sort: sort.column === c.id ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none' } : c));
    // `isEditing`, `editor` and `autoFocus` read edit and draft, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, accountId, draft, edit, payees, categories, parentCategories, fmt, money, showBalance, openAccounts, payeeById, categoryDisabled, draftAccount, byId, account, targetIds, toggleCleared, patchDraft, setDraft, today, sort, view.showFlags, scheduledCount]);

  /** One split line's editors, laid on the grid's columns (YNAB: payee, category, memo, outflow, inflow). */
  const splitLineEditor = (l: SplitLineDraft, i: number): ReactNode => {
    if (!draft) return null;
    const lineKey = l.key;
    const focus = (field: string): boolean => edit?.focus === `${lineKey}:${field}` || (i === 0 && edit?.focus === `line-1:${field}`);
    const patch = (x: Partial<Omit<SplitLineDraft, 'key' | 'id'>>): void => {
      const current = draftRef.current;
      if (current) setDraft(patchSplitLine(current, lineKey, x));
    };
    const linePayee = l.transferAccountId === null ? l.payeeId : (plan.payees.find((x) => x.transferAccountId === l.transferAccountId)?.id ?? null);
    const noCategory = draftAccount?.onBudget !== true || (l.transferAccountId !== null && !transferNeedsCategory(plan, draft.accountId, l.transferAccountId));
    return (
      <div key={lineKey} className={styles.splitEditLine} data-row-editor="" data-split-line={String(i + 1)}>
        <span className={styles.splitEditCell} />
        {columns.map((c) => (
          <span key={c.id} className={cx(styles.splitEditCell, (c.id === 'flag' || c.id === 'cleared') && styles.center)}>
            {c.id === 'flag' ? (
              <IconButton
                icon="subtract"
                size="small"
                label={`Remove split line ${String(i + 1)}`}
                onClick={() => {
                  const current = draftRef.current;
                  if (current) setDraft(removeSplitLine(current, lineKey));
                }}
              />
            ) : null}
            {c.id === 'payee' ? (
              <PayeePicker
                groups={payees}
                size="compact"
                value={linePayee}
                autoFocus={focus('payee')}
                onChange={(id) => {
                  const payee = payeeById.get(id);
                  if (payee?.transferAccountId !== undefined) patch({ transferAccountId: payee.transferAccountId, payeeId: null });
                  else {
                    const fill = l.categoryId === null && payee?.defaultCategoryId !== undefined && payee.defaultCategoryId !== null ? { categoryId: payee.defaultCategoryId } : {};
                    patch({ payeeId: id, transferAccountId: null, ...fill });
                  }
                }}
              />
            ) : null}
            {c.id === 'category' ? (
              noCategory ? (
                <span className={cx(styles.muted, styles.ellipsis)}>Category not needed</span>
              ) : (
                <CategoryPicker groups={categories.groups} available={categories.available} format={fmt} size="compact" value={l.categoryId} autoFocus={focus('category')} onChange={(id) => { patch({ categoryId: id }); }} />
              )
            ) : null}
            {c.id === 'memo' ? <TextInput label={`Memo, split line ${String(i + 1)}`} hideLabel size="compact" placeholder="Memo" value={l.memo} onChange={(e) => { patch({ memo: e.target.value }); }} /> : null}
            {c.id === 'outflow' ? <MoneyInput label={`Outflow, split line ${String(i + 1)}`} hideLabel variant="field" size="compact" value={l.outflow} format={fmt} onCommit={(v) => { patch(v > 0 ? { outflow: v, inflow: ZERO } : { outflow: v }); }} onEnter={() => undefined} /> : null}
            {c.id === 'inflow' ? <MoneyInput label={`Inflow, split line ${String(i + 1)}`} hideLabel variant="field" size="compact" value={l.inflow} format={fmt} onCommit={(v) => { patch(v > 0 ? { inflow: v, outflow: ZERO } : { inflow: v }); }} onEnter={() => undefined} /> : null}
          </span>
        ))}
      </div>
    );
  };

  // Under a row: the edit strip, or a split's lines aligned to the columns.
  const rowExtra = useCallback(
    (r: GridRow<Row>): { height: number; content: ReactNode } | undefined => {
      if (edit !== null && r.id === edit.id) {
        const lines = draft?.splits ?? null;
        const strip = (
          <div className={styles.strip} data-row-editor="">
              <span className={styles.hint}>Enter saves · Esc cancels · Ctrl+Enter saves and adds another</span>
              <Button size="small" onClick={cancel}>
                Cancel
              </Button>
              {edit.id === NEW && (
                <Button size="small" onClick={() => { save(true); }}>
                  Save and add another
                </Button>
              )}
              <Button size="small" variant="primary" onClick={() => { save(false); }}>
                Save
              </Button>
          </div>
        );
        if (lines === null || !draft) return { height: STRIP_HEIGHT, content: strip };
        const remaining = splitRemaining(draft);
        return {
          height: (lines.length + 1) * EDIT_LINE_HEIGHT + STRIP_HEIGHT,
          content: (
            <div className={styles.splitEditor}>
              {lines.map((l, i) => splitLineEditor(l, i))}
              <div className={styles.splitEditLine} data-row-editor="">
                <span className={styles.splitEditCell} />
                {columns.map((c) => (
                  <span key={c.id} className={cx(styles.splitEditCell, (c.id === 'outflow' || c.id === 'inflow') && styles.end)}>
                    {c.id === 'payee' ? (
                      <Button size="small" variant="toolbar" icon="add" onClick={() => { setDraft(addSplitLine(draft)); }}>
                        Add another split
                      </Button>
                    ) : null}
                    {c.id === 'memo' ? <span className={styles.remainingLabel}>Amount remaining to assign:</span> : null}
                    {c.id === 'outflow' ? <span className={cx(styles.remaining, remaining < 0 && styles.negative)} data-part="split-remaining-outflow">{money(remaining < 0 ? neg(remaining) : ZERO)}</span> : null}
                    {c.id === 'inflow' ? <span className={styles.remaining} data-part="split-remaining-inflow">{money(remaining > 0 ? remaining : ZERO)}</span> : null}
                  </span>
                ))}
              </div>
              <div style={{ height: STRIP_HEIGHT }}>{strip}</div>
            </div>
          ),
        };
      }
      if (r.data.kind === 'tx' && r.data.tx.splits.length > 0) {
        const lines = r.data.tx.splits;
        return {
          height: lines.length * SPLIT_LINE_HEIGHT,
          content: (
            <div className={styles.splits}>
              {lines.map((l) => (
                <div key={l.id} className={styles.splitLine}>
                  <span className={styles.splitCell} />
                  {columns.map((c) => (
                    <span key={c.id} className={cx(styles.splitCell, (c.id === 'outflow' || c.id === 'inflow' || c.id === 'balance') && styles.end, (c.id === 'payee' || c.id === 'category') && styles.indent)}>
                      {c.id === 'payee' ? <span className={cx(styles.ellipsis, styles.muted)}>{l.payee}</span> : null}
                      {c.id === 'category' ? <span className={cx(styles.ellipsis, l.category.tone === 'muted' && styles.muted)}>{l.category.text}</span> : null}
                      {c.id === 'memo' ? <span className={cx(styles.ellipsis, styles.muted)}>{l.memo}</span> : null}
                      {c.id === 'outflow' && l.amount < 0 ? money(neg(l.amount)) : null}
                      {c.id === 'inflow' && l.amount > 0 ? money(l.amount) : null}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ),
        };
      }
      return undefined;
    },
    // splitLineEditor reads draft and columns, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edit, draft, cancel, save, columns, money, setDraft],
  );

  // ---- header ------------------------------------------------------------------------------------
  const headerAccounts = account ? [account] : plan.accounts.filter((a) => a.deletedAt === undefined && a.onBudget && a.closed !== true);
  const total = (pick: 'cleared' | 'uncleared' | 'working'): Minor => minor(headerAccounts.reduce((s, a) => s + (balances[a.id]?.[pick] ?? 0), 0));
  const daysSince = account?.lastReconciledAt === undefined ? null : Math.max(0, Math.round((Date.parse(today) - Date.parse(account.lastReconciledAt.slice(0, 10))) / 86_400_000));
  const overdrawn = account !== undefined && CASH_ACCOUNT_TYPES.includes(account.type) && total('working') < 0;

  const applyView = (v: RegisterViewPref): void => {
    setReveal(false);
    prefs.update({ registerViews: { ...prefs.get().registerViews, [viewKey]: v } });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.title}>
          <h1>
            {account ? account.name : 'All Accounts'}
            {account && actions.accountAction && (
              <IconButton
                icon="star"
                label={account.starred === true ? `Unstar ${account.name}` : `Star ${account.name}`}
                aria-pressed={account.starred === true}
                className={cx(styles.star, account.starred === true && styles.starOn)}
                onClick={() => {
                  actions.accountAction?.(account.id, account.starred === true ? 'unstar' : 'star');
                }}
              />
            )}
          </h1>
          <p className={styles.subtitle}>
            {account ? (
              <>
                {typeInfo(account.type).label}
                {' · '}
                <Icon name="lock" className={styles.inline} />
                {daysSince === null ? 'Not yet reconciled' : daysSince === 0 ? 'Reconciled today' : `Reconciled ${String(daysSince)} day${daysSince === 1 ? '' : 's'} ago`}
                {account.note ? ` · ${account.note}` : ''}
              </>
            ) : (
              'Every cash, credit and tracking account'
            )}
          </p>
        </div>
        <div className={styles.balances} aria-label="Balances">
          <div>
            <strong>{money(total('cleared'))}</strong>
            <span>
              <Icon name="cleared" className={styles.ok} /> Cleared Balance
            </span>
          </div>
          <span className={styles.op} aria-hidden="true">
            +
          </span>
          <div>
            <strong>{money(total('uncleared'))}</strong>
            <span>
              <Icon name="uncleared" /> Uncleared Balance
            </span>
          </div>
          <span className={styles.op} aria-hidden="true">
            =
          </span>
          <div className={styles.working}>
            {/* Red only for an overdrawn cash account; a card or loan below zero is normal debt. */}
            <strong className={cx(overdrawn && styles.negative)}>{money(total('working'))}</strong>
            <span>Working Balance</span>
          </div>
        </div>
        {card && (
          <div className={styles.cardPills} aria-label="Credit card">
            {card.overspending > 0 && (
              <div>
                <Pill state="creditOverspent" title="Spending on this card this month that no category covered">
                  {money(card.overspending)}
                </Pill>
                <span>Overspending ({monthShort(card.month)})</span>
              </div>
            )}
            <div>
              <Pill state={card.underfunded ? 'underfunded' : card.payment > 0 ? 'funded' : 'zero'} title={card.underfunded ? 'Less is set aside than this card owes' : 'Set aside to pay this card'}>
                {money(card.payment)}
              </Pill>
              <span>Payment</span>
            </div>
          </div>
        )}
        {picked.length > 1 && (
          <div className={styles.selectedTotal} aria-live="polite">
            <strong>{money(selectedTotal([...schedRows, ...txRows], new Set(picked)))}</strong>
            <span>Selected Total ({picked.length})</span>
          </div>
        )}
        {account && (
          <div className={styles.headActions}>
            {actions.accountAction && <IconButton icon="edit" label={`Edit ${account.name}`} onClick={() => { actions.accountAction?.(account.id, 'edit'); }} />}
            <Button
              ref={reconcileButton}
              icon="lock"
              variant={reconcile?.step === 'mode' ? 'secondary' : 'primary'}
              disabled={account.closed === true || reconcile?.step === 'mode'}
              title="Reconcile (Shift+E)"
              aria-haspopup="dialog"
              aria-expanded={reconcile !== null && reconcile.step !== 'mode'}
              onClick={() => {
                setReconcile(reconcile === null ? { step: 'ask' } : null);
              }}
            >
              Reconcile
            </Button>
          </div>
        )}
      </header>

      {account && isLoanType(account.type) && <LoanPanel plan={plan} account={account} today={today} money={money} actions={actions} />}

      <div className={styles.toolbar}>
        <Button variant="toolbar" icon="add" title="Add a transaction (Shift+N)" onClick={() => { startNew(); }}>
          Add Transaction
        </Button>
        <Button variant="toolbar" icon="import" disabled title="Bank file import arrives in S6.5">
          File Import
        </Button>
        {card && account && (
          <Button
            variant="toolbar"
            icon="card"
            title="A payment to this card, pre-filled with what is set aside, up to the cleared balance"
            onClick={() => {
              startNew({ accountId: account.id, inflow: recordPaymentAmount(plan, budget, account.id) });
            }}
          >
            Record Payment
          </Button>
        )}
        {account && isLoanType(account.type) && account.closed !== true && (
          <Button variant="toolbar" icon="card" title="A payment to this loan from a cash or credit account" onClick={() => { setLoanPayment(true); }}>
            Record Payment
          </Button>
        )}
        <Button variant="toolbar" icon="undo" disabled={!history.canUndo} title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={actions.undo}>
          Undo
        </Button>
        <Button variant="toolbar" icon="redo" disabled={!history.canRedo} title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} onClick={actions.redo}>
          Redo
        </Button>
        <span className={styles.spacer} />
        <Button ref={viewButton} variant="toolbar" iconEnd="chevronDown" aria-haspopup="dialog" aria-expanded={viewOpen} onClick={() => { setViewOpen(!viewOpen); }}>
          View
        </Button>
        <TextInput
          ref={searchRef}
          label="Search transactions"
          hideLabel
          size="compact"
          prefix="search"
          placeholder={account ? `Search ${account.name}` : 'Search all accounts'}
          className={cx(styles.search)}
          value={searchText}
          aria-invalid={search.error !== null ? true : undefined}
          title="Search: Payee:, Category:, Memo:, Account:, Outflow: >=30, Before:, After:, On:, Flag:, is:unapproved…"
          onChange={(e) => {
            setSearchText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && searchText !== '') {
              e.preventDefault();
              setSearchText('');
            }
          }}
        />
      </div>
      {search.error !== null && (
        <p className={styles.searchError} role="status">
          <Icon name="warning" className={styles.inline} />
          {search.error}
        </p>
      )}
      {viewOpen && <ViewOptions anchor={viewButton} view={view} firstMonth={firstMonth} today={today} singleAccount={accountId !== null} onApply={applyView} onClose={() => { setViewOpen(false); }} />}

      {reconcileBanner()}
      {reconcilePopover()}
      {loanPayment && account && <RecordLoanPaymentDialog plan={plan} account={account} today={today} actions={actions} onClose={() => { setLoanPayment(false); }} />}
      {unapproved.length > 0 && (
        <div className={styles.banner}>
          <Notice
            actions={
              <>
                <Button size="small" aria-pressed={onlyUnapproved} onClick={() => { setOnlyUnapproved(!onlyUnapproved); }}>
                  {onlyUnapproved ? 'Show all' : 'Review'}
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  onClick={() => {
                    actions.run((pl, ctx) => approveTransactions(pl, ctx, { transactionIds: unapproved.map((t) => t.id) }));
                    setOnlyUnapproved(false);
                  }}
                >
                  Approve all
                </Button>
              </>
            }
          >
            <strong>
              {unapproved.length} {unapproved.length === 1 ? 'transaction needs' : 'transactions need'} approval.
            </strong>{' '}
            They already count in your plan; approve them once they look right.
          </Notice>
        </div>
      )}
      {counts.uncategorized > 0 && (
        <div className={styles.banner}>
          <Notice
            actions={
              <Button size="small" aria-pressed={onlyUncategorized} onClick={() => { setOnlyUncategorized(!onlyUncategorized); }}>
                {onlyUncategorized ? 'Show all' : 'View'}
              </Button>
            }
          >
            <strong>
              {counts.uncategorized} {counts.uncategorized === 1 ? 'transaction needs' : 'transactions need'} a category.
            </strong>{' '}
            Until then their money isn’t in any category.
          </Notice>
        </div>
      )}

      {searching && (
        <p className={styles.searchNote}>
          Some transactions are hidden by your search for “<strong>{searchText.trim()}</strong>”.
          <Button size="small" variant="toolbar" onClick={() => { setSearchText(''); }}>
            View All
          </Button>
        </p>
      )}
      <div className={styles.gridWrap} onKeyDown={(e) => { onEditKeyDown(e); onGridKeyDown(e); }} onPointerDownCapture={onRowPointerDown} onClick={onRowClick}>
        <DataGrid<Row>
          label={account ? `${account.name} transactions` : 'All transactions'}
          rows={rows}
          columns={columns}
          density="register"
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          rowExtra={rowExtra}
          enterMoves="none"
          onSaveAndAddAnother={() => { startNew(); }}
          onSort={(id) => {
            if (isSortable(id)) setSort(nextSort(sort, id));
          }}
          onRowContextMenu={(rowId, point) => {
            if (rowId === SCHEDULED || rowId === NEW || edit !== null) return;
            setFlagMenu(null);
            // Right-click on a row outside the selection selects just that row (YNAB).
            const ids = picked.includes(rowId) ? picked : [rowId];
            if (!picked.includes(rowId)) setSelected(new Set([rowId]));
            setRowMenu({ ids, at: { top: point.y, left: point.x, width: 0, height: 0 } });
          }}
          empty={searching ? `No transactions match “${searchText.trim()}”.` : onlyUncategorized ? 'Every transaction has a category.' : range !== null ? 'No transactions in these dates. View Options can show more.' : 'No transactions yet. Add one, or import a bank file.'}
          {...(request ? { request } : {})}
        />
      </div>
      {picked.length > 0 && edit === null && actionBar()}

      {flagMenu && (
        <Popover open onClose={() => { setFlagMenu(null); }} anchor={flagMenu.at} role="presentation">
          <MenuList
            label="Flag"
            items={[
              ...FLAG_COLORS.map((c, i) => ({ id: c, label: flagName(plan, c), icon: 'flag' as const, shortcut: `Shift+F ${String(i + 1)}` })),
              { id: 'none', label: 'No flag', shortcut: 'Shift+F 0' },
              { id: 'sep', label: '', separator: true },
              { id: 'rename', label: 'Rename flags…', icon: 'edit' as const },
            ]}
            onClose={() => { setFlagMenu(null); }}
            onSelect={(id) => {
              const ids = flagMenu.ids;
              if (id === 'rename') setRenamingFlags(true);
              else if (id === 'none') applyFlag(ids, null);
              else {
                const color = FLAG_COLORS.find((c) => c === id);
                if (color) applyFlag(ids, color);
              }
            }}
          />
        </Popover>
      )}
      {rowMenuNode()}
      {moreMenuNode()}
      {repeatFor && (
        <Popover open onClose={() => { setRepeatFor(null); }} anchor={repeatFor.at} role="presentation">
          <MenuList
            label="Repeat"
            items={FREQUENCIES.filter((f) => f.id !== 'never').map((f) => ({ id: f.id, label: f.label, icon: 'sync' as const }))}
            onClose={() => { setRepeatFor(null); }}
            onSelect={(id) => {
              const f = FREQUENCIES.find((x) => x.id === id);
              const target = repeatFor.id;
              setRepeatFor(null);
              if (f) repeat(target, f.id);
            }}
          />
        </Popover>
      )}
      {categorizeFor && (
        <Popover open onClose={() => { setCategorizeFor(null); }} anchor={categorizeFor.at} role="dialog" label="Categorize" className={styles.categorize}>
          <CategoryPicker
            groups={categories.groups}
            available={categories.available}
            format={fmt}
            size="medium"
            value={null}
            autoFocus
            initialQuery=""
            onChange={(id) => {
              const ids = categorizeFor.ids;
              setCategorizeFor(null);
              bulk(ids, { categoryId: id });
            }}
          />
        </Popover>
      )}
      {moveFor && (
        <Popover open onClose={() => { setMoveFor(null); }} anchor={moveFor.at} role="presentation">
          <MenuList
            label="Move to Account"
            items={openAccounts.map((a) => ({ id: a.id, label: a.name, icon: 'accounts' as const }))}
            onClose={() => { setMoveFor(null); }}
            onSelect={(id) => {
              const target = openAccounts.find((a) => a.id === id);
              bulk(moveFor.ids, { accountId: id }, `Moved ${plural(moveFor.ids.length).toLowerCase()} to ${target?.name ?? 'the account'}.`);
            }}
          />
        </Popover>
      )}
      {memoFor && (
        <MemoDialog
          count={memoFor.length}
          initial={memoFor.length === 1 ? (byId.get(memoFor[0] ?? '')?.memo ?? '') : ''}
          onClose={() => { setMemoFor(null); }}
          onSave={(memo) => {
            bulk(memoFor, { memo: memo.trim() === '' ? null : memo.trim() });
          }}
        />
      )}
      {renamingFlags && (
        <FlagNamesDialog
          plan={plan}
          onClose={() => { setRenamingFlags(false); }}
          onSave={(names) => {
            actions.run((pl, ctx) => {
              let next = pl;
              const sets: ChangeSet[] = [];
              for (const c of FLAG_COLORS) {
                const current = pl.flagNames.find((f) => f.color === c)?.name ?? '';
                const wanted = names[c].trim();
                if (wanted === current || (wanted === colorLabel(c) && current === '')) continue;
                const cmd = setFlagName(next, ctx, { color: c, name: wanted === colorLabel(c) ? '' : wanted });
                next = applyChanges(next, cmd.changes).plan;
                sets.push(cmd.changes);
              }
              return { label: 'Rename flags', changes: mergeChangeSets(...sets) };
            });
          }}
        />
      )}
    </div>
  );

  // ---- reconcile (S5.6) ----------------------------------------------------------------------------
  function finishReconcile(statement: Minor): void {
    if (!account) return;
    const id = account.id;
    actions.run((pl, ctx) => reconcileAccount(pl, ctx, { accountId: id, statementBalance: statement }), { announce: `Reconciled ${account.name}.` });
    setReconcile(null);
  }

  function reconcilePopover(): ReactNode {
    if (!account || reconcile === null || reconcile.step === 'mode') return null;
    const cleared = total('cleared');
    return (
      <Popover open onClose={() => { setReconcile(null); }} anchor={reconcileButton} placement="bottom-end" role="dialog" label="Reconcile" className={styles.reconcile}>
        {reconcile.step === 'ask' ? (
          <>
            <div className={styles.reconcileAsk}>
              <span>Is your current balance</span>
              <strong>{money(cleared)}?</strong>
            </div>
            <p className={styles.reconcileHint}>Your bank’s app or statement shows it. Count only what has cleared at the bank.</p>
            <div className={styles.reconcileButtons}>
              <Button
                variant="primary"
                onClick={() => {
                  reconcileAmount.current = ZERO;
                  setReconcile({ step: 'enter', amount: ZERO });
                }}
              >
                No
              </Button>
              <Button variant="primary" autoFocus onClick={() => { finishReconcile(cleared); }}>
                Yes
              </Button>
            </div>
          </>
        ) : (
          <>
            <MoneyInput
              ref={bankField}
              defaultDraft=""
              label="Current balance at your bank"
              variant="field"
              value={reconcile.amount}
              format={fmt}
              onCommit={(v) => {
                reconcileAmount.current = v;
                setReconcile({ step: 'enter', amount: v });
              }}
              onEnter={() => { setReconcile({ step: 'mode', statement: reconcileAmount.current }); }}
            />
            <div className={styles.reconcileButtons}>
              <Button
                variant="primary"
                onClick={() => {
                  // The field commits on blur, just before this click; the ref has its value.
                  setReconcile({ step: 'mode', statement: reconcileAmount.current });
                }}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Popover>
    );
  }

  function reconcileBanner(): ReactNode {
    if (!account || reconcile?.step !== 'mode') return null;
    const { difference } = reconcilePreview(plan, { accountId: account.id, statementBalance: reconcile.statement, date: today });
    const amount = money(difference < 0 ? neg(difference) : difference);
    const statement = reconcile.statement;
    return (
      <div className={styles.banner}>
        <Notice
          icon="lock"
          actions={
            <>
              <Button size="small" onClick={() => { setReconcile(null); }}>
                Cancel
              </Button>
              <Button size="small" variant="primary" onClick={() => { finishReconcile(statement); }}>
                {difference === 0 ? 'Finish' : 'Create Adjustment & Finish'}
              </Button>
            </>
          }
        >
          {difference === 0 ? (
            <strong>This account’s cleared balance matches your actual account.</strong>
          ) : (
            <>
              This account’s cleared balance is <strong>{amount}</strong> {difference < 0 ? 'higher' : 'lower'} than your actual account. Clear the transactions that have cleared at the bank, or finish with an adjustment.
            </>
          )}
        </Notice>
      </div>
    );
  }

  // ---- selection: action bar, right-click menu, More --------------------------------------------
  function bulkItems(ids: string[], where: 'menu' | 'more'): MenuItem[] {
    const { tx, sched } = splitIds(ids);
    if (sched.length > 0 && tx.length === 0) {
      // YNAB: Enter Now (E) first; Match, Unmatch and Duplicate stay, but apply to transactions only.
      const items: MenuItem[] = [];
      if (where === 'menu') items.push({ id: 'enterNow', label: 'Enter Now', icon: 'checkmark', shortcut: 'E' });
      items.push({ id: 'skip', label: 'Skip Next', icon: 'calendarClock' }, { id: 'sep1', label: '', separator: true });
      if (where === 'menu') items.push({ id: 'flag', label: 'Flag…', icon: 'flag', shortcut: 'Shift+F' });
      items.push({ id: 'memo', label: 'Memo…', icon: 'note' });
      if (where === 'menu') items.push({ id: 'categorize', label: 'Categorize…', icon: 'tag', shortcut: 'K' });
      items.push({ id: 'sep2', label: '', separator: true }, { id: 'delete', label: 'Delete', icon: 'dismiss', danger: true, shortcut: 'Del' });
      return items;
    }
    const rows = ids.map((id) => byId.get(id)).filter((t) => t !== undefined);
    const anyUnapproved = rows.some((t) => t.approved === false);
    const n = ids.length;
    const items: MenuItem[] = [];
    if (where === 'menu') {
      items.push(
        { id: 'approve', label: 'Approve', icon: 'checkmark', shortcut: 'A', disabled: !anyUnapproved },
        { id: 'reject', label: 'Reject', icon: 'dismiss', shortcut: 'Shift+R', disabled: true },
        { id: 'sep1', label: '', separator: true },
        { id: 'markCleared', label: 'Mark as Cleared', icon: 'cleared', shortcut: 'C', disabled: !rows.some((t) => t.cleared === 'uncleared') },
        { id: 'markUncleared', label: 'Mark as Uncleared', icon: 'uncleared', shortcut: 'C', disabled: !rows.some((t) => t.cleared === 'cleared') },
        { id: 'sep2', label: '', separator: true },
      );
    }
    items.push(
      { id: 'match', label: 'Match', icon: 'link', shortcut: 'M', disabled: true },
      { id: 'unmatch', label: 'Unmatch', icon: 'link', shortcut: 'Shift+U', disabled: true },
      { id: 'sep3', label: '', separator: true },
      { id: 'duplicate', label: 'Duplicate', icon: 'copy', shortcut: 'Shift+D' },
    );
    if (where === 'menu') items.push({ id: 'repeat', label: 'Make Repeating', icon: 'history', shortcut: 'Shift+T', disabled: tx.length !== 1 }, { id: 'sep4', label: '', separator: true }, { id: 'flag', label: 'Flag…', icon: 'flag', shortcut: 'Shift+F' });
    else items.push({ id: 'sep4', label: '', separator: true });
    items.push({ id: 'memo', label: 'Memo…', icon: 'note' });
    if (where === 'menu') items.push({ id: 'categorize', label: 'Categorize…', icon: 'tag', shortcut: 'K' });
    items.push(
      { id: 'move', label: 'Move to Account…', icon: 'transfer' },
      { id: 'sep5', label: '', separator: true },
      { id: 'export', label: `Export ${plural(n)}`, icon: 'export', disabled: true },
      { id: 'sep6', label: '', separator: true },
      { id: 'delete', label: 'Delete', icon: 'dismiss', danger: true, shortcut: 'Del' },
    );
    return items;
  }

  function onBulk(id: string, ids: string[], at: Rect): void {
    if (id === 'enterNow') enterNow(ids);
    else if (id === 'skip') skip(ids);
    else if (id === 'repeat') {
      const one = splitIds(ids).tx[0];
      if (one !== undefined) setRepeatFor({ id: one, at });
    } else if (id === 'approve') approve(ids);
    else if (id === 'markCleared') setClearedTo(ids, 'cleared');
    else if (id === 'markUncleared') setClearedTo(ids, 'uncleared');
    else if (id === 'duplicate') duplicate(ids);
    else if (id === 'flag') setFlagMenu({ ids, at });
    else if (id === 'memo') setMemoFor(ids);
    else if (id === 'categorize') setCategorizeFor({ ids, at });
    else if (id === 'move') setMoveFor({ ids, at });
    else if (id === 'delete') remove(ids);
  }

  function rowMenuNode(): ReactNode {
    if (!rowMenu) return null;
    const ids = rowMenu.ids;
    return (
      <Popover open onClose={() => { setRowMenu(null); }} anchor={rowMenu.at} role="presentation">
        <MenuList
          label="Transaction"
          items={bulkItems(ids, 'menu')}
          onClose={() => { setRowMenu(null); }}
          onSelect={(id) => { onBulk(id, ids, rowMenu.at); }}
        />
      </Popover>
    );
  }

  function moreMenuNode(): ReactNode {
    if (!moreFor) return null;
    const ids = moreFor.ids;
    return (
      <Popover open onClose={() => { setMoreFor(null); }} anchor={moreFor.at} placement="top-end" role="presentation">
        <MenuList label="More" items={bulkItems(ids, 'more')} onClose={() => { setMoreFor(null); }} onSelect={(id) => { onBulk(id, ids, moreFor.at); }} />
      </Popover>
    );
  }

  function actionBar(): ReactNode {
    const ids = picked;
    const rows = ids.map((id) => byId.get(id)).filter((t) => t !== undefined);
    const at = (e: { currentTarget: HTMLElement }): Rect => {
      const r = e.currentTarget.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    };
    const onlySched = rows.length === 0 && splitIds(ids).sched.length > 0;
    return (
      <ActionBar label={plural(ids.length)} onClear={() => { setSelected(new Set()); }}>
        {onlySched && <ActionBarButton icon="checkmark" label="Enter Now" title="Enter now (E)" onClick={() => { enterNow(ids); }} />}
        {rows.some((t) => t.approved === false) && <ActionBarButton icon="checkmark" label="Approve" title="Approve (A)" onClick={() => { approve(ids); }} />}
        <ActionBarButton icon="tag" label="Categorize" title="Categorize (K)" aria-haspopup="dialog" onClick={(e) => { setCategorizeFor({ ids, at: { ...at(e), top: at(e).top - 8 } }); }} />
        <ActionBarButton icon="flag" label="Flag" title="Flag (Shift+F)" aria-haspopup="menu" onClick={(e) => { setFlagMenu({ ids, at: at(e) }); }} />
        {rows.some((t) => t.cleared === 'uncleared') && <ActionBarButton icon="cleared" label="Clear" title="Mark as cleared (C)" onClick={() => { setClearedTo(ids, 'cleared'); }} />}
        <ActionBarRule />
        <ActionBarButton icon="more" label="More" aria-haspopup="menu" onClick={(e) => { setMoreFor({ ids, at: at(e) }); }} />
      </ActionBar>
    );
  }

  // A click on the only selected row edits it (YNAB); the first click just selects.
  function onRowPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[role=row][data-row-id]') : null;
    const id = row?.dataset.rowId;
    clickEdits.current = id !== undefined && edit === null && selected.size === 1 && selected.has(id) && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.button === 0 ? id : null;
  }
  function onRowClick(e: React.MouseEvent<HTMLDivElement>): void {
    const id = clickEdits.current;
    clickEdits.current = null;
    if (id === null || !(e.target instanceof Element) || e.target.closest('input, button, [role=combobox], [data-interactive], [data-select]')) return;
    const col = e.target.closest<HTMLElement>('[data-col]')?.dataset.col;
    if (id !== SCHEDULED && id !== NEW) startEdit(id, col === undefined || col === '__select__' || col === 'flag' || col === 'cleared' ? 'payee' : col);
  }
}

function MemoDialog({ count, initial, onClose, onSave }: { count: number; initial: string; onClose: () => void; onSave: (memo: string) => void }) {
  const [memo, setMemo] = useState(initial);
  const save = (): void => {
    onClose();
    onSave(memo);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Memo"
      description={count === 1 ? 'The memo for this transaction.' : `One memo for all ${String(count)} transactions; it replaces theirs.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <TextInput
        label="Memo"
        autoFocus
        value={memo}
        onChange={(e) => {
          setMemo(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
      />
    </Dialog>
  );
}

function FlagNamesDialog({ plan, onClose, onSave }: { plan: PlanData; onClose: () => void; onSave: (names: Record<FlagColor, string>) => void }) {
  const [names, setNames] = useState<Record<FlagColor, string>>(() => ({
    red: flagName(plan, 'red'),
    orange: flagName(plan, 'orange'),
    yellow: flagName(plan, 'yellow'),
    green: flagName(plan, 'green'),
    blue: flagName(plan, 'blue'),
    purple: flagName(plan, 'purple'),
  }));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rename flags"
      description="Give the six flags your own meanings, like Reimbursable or Tax deductible. Leave a name as its colour to keep it plain."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onSave(names);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className={styles.flagNames}>
        {FLAG_COLORS.map((c) => (
          <div key={c} className={styles.flagName}>
            <span style={{ color: `var(--c-flag-${c})` }} aria-hidden="true">
              <Icon name="flag" />
            </span>
            <TextInput
              label={`${colorLabel(c)} flag`}
              hideLabel
              size="compact"
              value={names[c]}
              onChange={(e) => {
                setNames({ ...names, [c]: e.target.value });
              }}
            />
          </div>
        ))}
      </div>
    </Dialog>
  );
}

