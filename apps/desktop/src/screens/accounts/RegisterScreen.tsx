// The register (S4.5), rebuilt from the component library on the DataGrid in the approved S3.1
// look (ADR 0007). YNAB's editing model: a row is edited whole (every field at once) with Cancel /
// Save / Save and add another under it; Enter saves, Esc cancels, Tab moves between fields,
// Ctrl+Enter saves and starts another. Shortcuts follow YNAB's list: Shift+N adds, C toggles
// cleared, Shift+F then 0–6 flags, Delete deletes.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CASH_ACCOUNT_TYPES, type ClearedState, type FlagColor, type Id } from '@hafb/engine';
import { formatDate, minor, monthOf, neg, ZERO, type ISODate, type Minor } from '@hafb/shared';
import {
  addTransaction,
  applyChanges,
  approveTransactions,
  deleteTransactions,
  editTransaction,
  mergeChangeSets,
  planBudget,
  setCleared,
  setFlag,
  setFlagName,
  type ChangeSet,
  type PlanData,
} from '@hafb/store';
import type { Actions } from '../../design/DesignApp.tsx';
import { prefs, usePrefs } from '../../shell/prefs.ts';
import { Notice } from '../../ui/Banner.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { CategoryPicker } from '../../ui/CategoryPicker.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { cx } from '../../ui/cx.ts';
import { DateInput } from '../../ui/DateInput.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { DataGrid, type GridColumn } from '../../ui/grid/DataGrid.tsx';
import type { GridRow } from '../../ui/grid/types.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MenuButton, MenuList, type MenuItem } from '../../ui/Menu.tsx';
import { MoneyInput } from '../../ui/MoneyInput.tsx';
import { PayeePicker } from '../../ui/PayeePicker.tsx';
import { categoryPickerData, payeeGroups } from '../../ui/pickerData.ts';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import { useShortcut } from '../../ui/shortcuts/ShortcutProvider.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import { moneyFormat } from '../plan/planModel.ts';
import { moneyText } from '../shared/money.ts';
import { typeInfo } from './accountsModel.ts';
import { colorLabel, FLAG_COLORS, flagForDigit, flagName } from './flags.ts';
import { defaultCleared, draftFor, registerRows, toInput, toPatch, transferNeedsCategory, type RegisterRow, type TxDraft } from './registerModel.ts';
import styles from './RegisterScreen.module.css';

const NEW = '__new__';
/** The typed name of a payee that the save will create. */
const NEW_PAYEE = '__new-payee__';
const SCHEDULED = '__scheduled__';
const STRIP_HEIGHT = 42;
const SPLIT_LINE_HEIGHT = 26;

type Row = { kind: 'tx'; tx: RegisterRow } | { kind: 'new' } | { kind: 'scheduled'; count: number };

const NEXT_CLEARED: Record<ClearedState, ClearedState> = { uncleared: 'cleared', cleared: 'uncleared', reconciled: 'reconciled' };

export interface RegisterScreenProps {
  plan: PlanData;
  today: ISODate;
  accountId: Id | null;
  actions: Actions;
  history: { canUndo: boolean; canRedo: boolean; undoLabel: string | undefined; redoLabel: string | undefined };
}

export function RegisterScreen({ plan, today, accountId, actions, history }: RegisterScreenProps) {
  const p = usePrefs();
  const fmt = moneyFormat(plan);
  const money = useMemo(() => moneyText(fmt, p.hideAmounts), [fmt, p.hideAmounts]);
  const account = accountId === null ? undefined : plan.accounts.find((a) => a.id === accountId);
  const balances = useMemo(() => planBudget(plan, { today }).accountBalances, [plan, today]);
  const [query, setQuery] = useState('');
  const [onlyUnapproved, setOnlyUnapproved] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [edit, setEdit] = useState<{ id: string; focus: string } | null>(null);
  const [draft, setDraftState] = useState<TxDraft | null>(null);
  const draftRef = useRef<TxDraft | null>(null);
  const [request, setRequest] = useState<{ cell: { rowId: string; columnId: string }; edit: boolean; key: number } | undefined>(undefined);
  const [flagMenu, setFlagMenu] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [renamingFlags, setRenamingFlags] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const showBalance = accountId !== null && p.showRunningBalance;

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

  const txRows = useMemo(() => registerRows(plan, { accountId, query, onlyUnapproved }), [plan, accountId, query, onlyUnapproved]);
  const byId = useMemo(() => new Map(plan.transactions.map((t) => [t.id, t])), [plan.transactions]);
  const unapproved = useMemo(() => plan.transactions.filter((t) => t.deletedAt === undefined && t.approved === false && (accountId === null || t.accountId === accountId)), [plan.transactions, accountId]);
  const scheduledCount = plan.scheduled.filter((s) => s.deletedAt === undefined && (accountId === null || s.accountId === accountId)).length;

  const rows = useMemo((): GridRow<Row>[] => {
    const out: GridRow<Row>[] = [{ kind: 'group', id: SCHEDULED, data: { kind: 'scheduled', count: scheduledCount } }];
    if (edit?.id === NEW) out.push({ kind: 'item', id: NEW, data: { kind: 'new' } });
    for (const tx of txRows) out.push({ kind: 'item', id: tx.id, data: { kind: 'tx', tx } });
    return out;
  }, [txRows, edit?.id, scheduledCount]);

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
      setDraft({ ...draftFor(null, { accountId: acct, date: from?.date ?? today, cleared: defaultCleared(plan, acct) }) });
      setEdit({ id: NEW, focus: accountId === null ? 'account' : 'date' });
    },
    [firstAccount, today, plan, accountId, actions, setDraft],
  );

  const startEdit = useCallback(
    (id: string, focus = 'payee') => {
      const t = byId.get(id);
      if (!t) return;
      if (t.cleared === 'reconciled') actions.notify('This transaction is reconciled. Changing it can make the account disagree with your bank.');
      setDraft(draftFor(t, { accountId: t.accountId, date: t.date }));
      setEdit({ id, focus });
    },
    [byId, actions, setDraft],
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
      if (edit.id === NEW) {
        if (d.inflow === 0 && d.outflow === 0 && d.payeeId === null && d.payeeName.trim() === '' && d.transferAccountId === null && d.memo.trim() === '' && d.categoryId === null) {
          cancel();
          return;
        }
        actions.run((pl, ctx) => addTransaction(pl, ctx, toInput(pl, d)));
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
    [edit, byId, plan, actions, startNew, cancel, setDraft],
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
    if (selected.size > 0 && (rowId === undefined || selected.has(rowId))) return [...selected];
    return rowId === undefined ? [] : [rowId];
  }, [selected]);
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
      if (ids.length > 0) actions.run((pl, ctx) => setFlag(pl, ctx, { transactionIds: ids, flag }));
    },
    [actions],
  );
  const remove = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      actions.run((pl, ctx) => deleteTransactions(pl, ctx, { transactionIds: ids }), { announce: ids.length === 1 ? 'Deleted the transaction.' : `Deleted ${String(ids.length)} transactions.` });
      setSelected(new Set());
    },
    [actions],
  );

  // Shortcuts (YNAB's list). Shift+F waits for a digit: 1–6 a colour, 0 clears.
  const flagPending = useRef<number>(0);
  useShortcut({ id: 'register.add', keys: 'Shift+N', description: 'Add a new transaction', group: 'Register', scope: 'screen', run: () => { startNew(); } });
  useShortcut({ id: 'register.toggleCleared', keys: 'C', description: 'Toggle cleared for the selection', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { toggleCleared(targetIds(activeRowId())); } });
  useShortcut({ id: 'register.flag', keys: 'Shift+F', description: 'Flag (then 1–6 for a colour, 0 to clear)', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { flagPending.current = performance.now(); } });
  useShortcut({ id: 'register.delete', keys: 'Delete', description: 'Delete', group: 'Register', scope: 'screen', enabled: edit === null, run: () => { remove(targetIds(activeRowId())); } });
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
  const payees = useMemo(() => payeeGroups(plan, draftAccountId === undefined ? {} : { excludeAccountId: draftAccountId }), [plan, draftAccountId]);
  const categories = useMemo(() => categoryPickerData(plan, draftMonth, today), [plan, draftMonth, today]);
  const payeeById = useMemo(() => new Map(plan.payees.map((x) => [x.id, x])), [plan.payees]);
  const isEditing = (r: GridRow<Row>): boolean => edit !== null && r.id === edit.id;
  const draftAccount = draft ? plan.accounts.find((a) => a.id === draft.accountId) : undefined;
  const categoryDisabled = draft !== null && (draftAccount?.onBudget !== true || (draft.transferAccountId !== null && !transferNeedsCategory(plan, draft.accountId, draft.transferAccountId)) || (edit !== null && edit.id !== NEW && (byId.get(edit.id)?.subtransactions?.length ?? 0) > 0));

  const autoFocus = (col: string): boolean => edit?.focus === col;
  const editor = (col: string, node: ReactNode): ReactNode => (
    <div className={styles.field} data-row-editor="" data-field={col}>
      {node}
    </div>
  );

  const columns = useMemo((): GridColumn<Row>[] => {
    const cols: GridColumn<Row>[] = [
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
                <Icon name="calendarClock" /> Scheduled <span className={styles.muted}>({r.data.count})</span>
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
    ];
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
            ? editor('date', <DateInput label="Date" hideLabel size="compact" value={draft.date} format={plan.settings.dateFormat} today={today} calendarTabStop={false} onCommit={(date) => { patchDraft({ date }); }} autoFocus={autoFocus('date')} />)
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
            if (categoryDisabled) return editor('category', <span className={cx(styles.muted, styles.ellipsis)}>{draft.transferAccountId !== null || draftAccount?.onBudget !== true ? 'Category not needed' : 'Split (edit lines in S4.6)'}</span>);
            return editor(
              'category',
              <CategoryPicker
                groups={categories.groups}
                available={categories.available}
                format={fmt}
                size="compact"
                value={draft.categoryId}
                autoFocus={autoFocus('category')}
                onChange={(id) => {
                  patchDraft({ categoryId: id });
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
                  disabled={edit?.id !== NEW && (byId.get(edit?.id ?? '')?.subtransactions?.length ?? 0) > 0}
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
                  disabled={edit?.id !== NEW && (byId.get(edit?.id ?? '')?.subtransactions?.length ?? 0) > 0}
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
        const state: ClearedState | undefined = isEditing(r) && draft ? draft.cleared : r.data.kind === 'tx' ? r.data.tx.cleared : undefined;
        if (state === undefined) return null;
        const label = state === 'reconciled' ? 'Reconciled' : state === 'cleared' ? 'Cleared' : 'Uncleared';
        return (
          <button
            type="button"
            data-interactive=""
            data-row-editor={isEditing(r) ? '' : undefined}
            className={cx(styles.cleared, state === 'cleared' && styles.isCleared, state === 'reconciled' && styles.isReconciled)}
            aria-label={state === 'reconciled' ? 'Reconciled' : `${label}. Toggle cleared`}
            title={label}
            disabled={state === 'reconciled'}
            onClick={() => {
              if (isEditing(r)) patchDraft({ cleared: NEXT_CLEARED[state] });
              else if (r.data.kind === 'tx') toggleCleared([r.data.tx.id]);
            }}
          >
            <Icon name={state === 'reconciled' ? 'lock' : state === 'cleared' ? 'cleared' : 'uncleared'} />
          </button>
        );
      },
    });
    return cols;
    // `isEditing`, `editor` and `autoFocus` read edit and draft, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, accountId, draft, edit, payees, categories, fmt, money, showBalance, openAccounts, payeeById, categoryDisabled, draftAccount, byId, account, targetIds, toggleCleared, patchDraft, today]);

  // Under a row: the edit strip, or a split's lines aligned to the columns.
  const rowExtra = useCallback(
    (r: GridRow<Row>): { height: number; content: ReactNode } | undefined => {
      if (edit !== null && r.id === edit.id) {
        return {
          height: STRIP_HEIGHT,
          content: (
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
    [edit, cancel, save, columns, money],
  );

  // ---- header ------------------------------------------------------------------------------------
  const headerAccounts = account ? [account] : plan.accounts.filter((a) => a.deletedAt === undefined && a.onBudget && a.closed !== true);
  const total = (pick: 'cleared' | 'uncleared' | 'working'): Minor => minor(headerAccounts.reduce((s, a) => s + (balances[a.id]?.[pick] ?? 0), 0));
  const daysSince = account?.lastReconciledAt === undefined ? null : Math.max(0, Math.round((Date.parse(today) - Date.parse(account.lastReconciledAt.slice(0, 10))) / 86_400_000));
  const overdrawn = account !== undefined && CASH_ACCOUNT_TYPES.includes(account.type) && total('working') < 0;

  const viewItems: MenuItem[] = [{ id: 'balance', label: 'Show running balance', checked: p.showRunningBalance, disabled: accountId === null }];

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
                {daysSince === null ? 'Not yet reconciled' : `Reconciled ${String(daysSince)} days ago`}
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
        {account && (
          <div className={styles.headActions}>
            {actions.accountAction && <IconButton icon="edit" label={`Edit ${account.name}`} onClick={() => { actions.accountAction?.(account.id, 'edit'); }} />}
            <Button icon="lock" disabled title="Reconcile arrives in S5.6">
              Reconcile
            </Button>
          </div>
        )}
      </header>

      <div className={styles.toolbar}>
        <Button variant="toolbar" icon="add" title="Add a transaction (Shift+N)" onClick={() => { startNew(); }}>
          Add Transaction
        </Button>
        <Button variant="toolbar" icon="import" disabled title="Bank file import arrives in S6.5">
          File Import
        </Button>
        <Button variant="toolbar" icon="undo" disabled={!history.canUndo} title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={actions.undo}>
          Undo
        </Button>
        <Button variant="toolbar" icon="redo" disabled={!history.canRedo} title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} onClick={actions.redo}>
          Redo
        </Button>
        <span className={styles.spacer} />
        <MenuButton
          label="View"
          items={viewItems}
          placement="bottom-end"
          onSelect={(id) => {
            if (id === 'balance') prefs.update({ showRunningBalance: !p.showRunningBalance });
          }}
          trigger={(t) => (
            <Button {...t} variant="toolbar" iconEnd="chevronDown">
              View
            </Button>
          )}
        />
        <TextInput
          ref={searchRef}
          label="Search transactions"
          hideLabel
          size="compact"
          prefix="search"
          placeholder={account ? `Search ${account.name}` : 'Search all accounts'}
          className={cx(styles.search)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
      </div>

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

      <div className={styles.gridWrap} onKeyDown={(e) => { onEditKeyDown(e); onGridKeyDown(e); }}>
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
          onRowContextMenu={(rowId, point) => {
            if (rowId === SCHEDULED || rowId === NEW) return;
            setFlagMenu(null);
            setRowMenu({ ids: targetIds(rowId), at: { top: point.y, left: point.x, width: 0, height: 0 } });
          }}
          empty={query.trim() !== '' ? `No transactions match “${query.trim()}”.` : 'No transactions yet. Add one, or import a bank file.'}
          {...(request ? { request } : {})}
        />
      </div>

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

  function rowMenuNode(): ReactNode {
    if (!rowMenu) return null;
    const ids = rowMenu.ids;
    const one = ids.length === 1 ? byId.get(ids[0] ?? '') : undefined;
    return (
      <Popover open onClose={() => { setRowMenu(null); }} anchor={rowMenu.at} role="presentation">
        <MenuList
          label="Transaction"
          items={[
            ...(one ? [{ id: 'edit', label: 'Edit', icon: 'edit' as const, shortcut: 'Enter' }] : []),
            { id: 'cleared', label: 'Toggle cleared', icon: 'cleared', shortcut: 'C' },
            { id: 'flag', label: 'Flag…', icon: 'flag', shortcut: 'Shift+F' },
            ...(ids.some((id) => byId.get(id)?.approved === false) ? [{ id: 'approve', label: 'Approve', icon: 'checkmark' as const }] : []),
            { id: 'sep', label: '', separator: true },
            { id: 'delete', label: ids.length === 1 ? 'Delete' : `Delete ${String(ids.length)} transactions`, icon: 'dismiss', danger: true, shortcut: 'Del' },
          ]}
          onClose={() => { setRowMenu(null); }}
          onSelect={(id) => {
            if (id === 'edit' && one) startEdit(one.id);
            else if (id === 'cleared') toggleCleared(ids);
            else if (id === 'flag') setFlagMenu({ ids, at: rowMenu.at });
            else if (id === 'approve') actions.run((pl, ctx) => approveTransactions(pl, ctx, { transactionIds: ids }));
            else if (id === 'delete') remove(ids);
          }}
        />
      </Popover>
    );
  }
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

