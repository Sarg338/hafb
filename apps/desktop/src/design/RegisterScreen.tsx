// S3.1 Register mockup: YNAB's register structure in HAFB's look, on the sample household.
// Balances come from the engine; rows are the plan's records; edits go through real commands.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { READY_TO_ASSIGN, type CategoryRef, type ClearedState, type FlagColor, type Id, CASH_ACCOUNT_TYPES } from '@hafb/engine';
import { asISODate, dateParts, isISODate, minor, neg, parseDecimal, ZERO, type ISODate, type Minor } from '@hafb/shared';
import { usePrefs } from '../shell/prefs.ts';
import { moneyText } from '../screens/shared/money.ts';
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
  type ChangeSet,
  type PlanData,
  type TransactionRecord,
} from '@hafb/store';
import { Icon, type IconName } from '../ui/Icon.tsx';
import type { Actions } from './DesignApp.tsx';
import { moneyFormat } from '../screens/plan/planModel.ts';
import './register.css';

const TYPE_LABEL: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  creditCard: 'Credit card',
  lineOfCredit: 'Line of credit',
  mortgage: 'Mortgage',
  autoLoan: 'Auto loan',
  studentLoan: 'Student loan',
  personalLoan: 'Personal loan',
  medicalDebt: 'Medical debt',
  otherDebt: 'Other debt',
  asset: 'Asset',
  liability: 'Liability',
};

const FLAG_VAR: Record<FlagColor, string> = {
  red: 'var(--c-flag-red)',
  orange: 'var(--c-flag-orange)',
  yellow: 'var(--c-flag-yellow)',
  green: 'var(--c-flag-green)',
  blue: 'var(--c-flag-blue)',
  purple: 'var(--c-flag-purple)',
};

const CLEARED_ICON: Record<ClearedState, { icon: IconName; label: string }> = {
  uncleared: { icon: 'uncleared', label: 'Uncleared' },
  cleared: { icon: 'cleared', label: 'Cleared' },
  reconciled: { icon: 'lock', label: 'Reconciled' },
};

const NEW = '__new__';

const NEXT_CLEARED: Record<ClearedState, ClearedState> = { uncleared: 'cleared', cleared: 'uncleared', reconciled: 'reconciled' };

/** MM/DD/YYYY, the sample plan's date format. */
function showDate(date: ISODate): string {
  const p = dateParts(date);
  return `${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')}/${String(p.year)}`;
}

function readDate(text: string): ISODate | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[3] ?? ''}-${(m[1] ?? '').padStart(2, '0')}-${(m[2] ?? '').padStart(2, '0')}`;
  return isISODate(iso) ? asISODate(iso) : null;
}

/** Plain decimal for an input ("12.50"), no symbol or grouping. */
function plain(m: Minor, decimals: number): string {
  if (m === ZERO) return '';
  const digits = String(Math.abs(m)).padStart(decimals + 1, '0');
  return decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
}

interface Draft {
  date: string;
  payee: string;
  category: string;
  memo: string;
  outflow: string;
  inflow: string;
  account: string;
}

export function RegisterScreen({ plan, today, accountId, actions }: { plan: PlanData; today: ISODate; accountId: Id | null; actions: Actions }) {
  const fmt = moneyFormat(plan);
  const { hideAmounts } = usePrefs();
  const money = moneyText(fmt, hideAmounts);
  const balances = planBudget(plan, { today }).accountBalances;
  const account = accountId === null ? undefined : plan.accounts.find((a) => a.id === accountId);
  const [selected, setSelected] = useState<ReadonlySet<Id>>(new Set());
  // The row being edited: a transaction id, NEW for the add-transaction row, or null.
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyUnapproved, setOnlyUnapproved] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // A different account is a different register: drop selection and edits (adjusted during render).
  const [shownFor, setShownFor] = useState(accountId);
  if (shownFor !== accountId) {
    setShownFor(accountId);
    setSelected(new Set());
    setEditing(null);
    setOnlyUnapproved(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const names = useMemo(() => {
    const accounts = new Map(plan.accounts.map((a) => [a.id, a]));
    const payees = new Map(plan.payees.map((p) => [p.id, p.name]));
    const categories = new Map(plan.categories.map((c) => [c.id, c.name]));
    return { accounts, payees, categories };
  }, [plan]);

  const categoryOptions = useMemo(() => {
    const live = <T extends { deletedAt?: string }>(xs: readonly T[]): T[] => xs.filter((x) => x.deletedAt === undefined);
    return live(plan.categoryGroups)
      .filter((g) => g.systemKind === undefined)
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        group: g.name,
        categories: live(plan.categories)
          .filter((c) => c.groupId === g.id)
          .toSorted((a, b) => a.sortOrder - b.sortOrder),
      }));
  }, [plan]);

  const categoryLabel = (t: { categoryId: CategoryRef; transferAccountId?: Id; subtransactions?: readonly unknown[] }, onBudget: boolean): { text: string; muted: boolean } => {
    if (t.subtransactions && t.subtransactions.length > 0) return { text: `Split (${String(t.subtransactions.length)})`, muted: false };
    if (t.categoryId === READY_TO_ASSIGN) return { text: 'Ready to Assign', muted: false };
    if (t.categoryId !== null) return { text: names.categories.get(t.categoryId) ?? 'Unknown category', muted: false };
    if (t.transferAccountId !== undefined) {
      const other = names.accounts.get(t.transferAccountId);
      return { text: onBudget && other?.onBudget === true ? 'Needs no category' : '', muted: true };
    }
    return onBudget ? { text: 'Uncategorized', muted: true } : { text: '', muted: true };
  };

  const rows = useMemo(() => {
    const liveAccounts = new Set(plan.accounts.filter((a) => a.deletedAt === undefined).map((a) => a.id));
    const q = query.trim().toLowerCase();
    return plan.transactions
      .filter((t) => t.deletedAt === undefined && liveAccounts.has(t.accountId) && (accountId === null || t.accountId === accountId))
      .filter((t) => !onlyUnapproved || t.approved === false)
      .filter((t) => {
        if (q === '') return true;
        const hay = [names.payees.get(t.payeeId ?? '') ?? '', t.memo ?? '', t.categoryId === null ? '' : (names.categories.get(t.categoryId) ?? '')].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .toSorted((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  }, [plan, accountId, query, onlyUnapproved, names]);

  const allInView = useMemo(
    () => plan.transactions.filter((t) => t.deletedAt === undefined && (accountId === null || t.accountId === accountId)),
    [plan, accountId],
  );
  const unapproved = allInView.filter((t) => t.approved === false);
  const scheduled = plan.scheduled.filter((s) => s.deletedAt === undefined && (accountId === null || s.accountId === accountId));

  const headerAccounts = account ? [account] : plan.accounts.filter((a) => a.deletedAt === undefined && a.onBudget);
  const total = (pick: 'cleared' | 'uncleared' | 'working'): Minor => minor(headerAccounts.reduce((s, a) => s + (balances[a.id]?.[pick] ?? 0), 0));

  const toggle = (id: Id, additive: boolean): void => {
    setSelected((s) => {
      if (!additive) return new Set([id]);
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const draftFor = (t: TransactionRecord | null): Draft => ({
    date: showDate(t?.date ?? today),
    payee: t?.payeeId !== undefined ? (names.payees.get(t.payeeId) ?? '') : '',
    category: t === null ? '' : t.categoryId ?? '',
    memo: t?.memo ?? '',
    outflow: t && t.amount < 0 ? plain(neg(t.amount), fmt.decimals) : '',
    inflow: t && t.amount > 0 ? plain(t.amount, fmt.decimals) : '',
    account: t?.accountId ?? accountId ?? plan.accounts.find((a) => a.onBudget && a.deletedAt === undefined)?.id ?? '',
  });

  const save = (t: TransactionRecord | null, d: Draft): void => {
    const date = readDate(d.date);
    if (date === null) {
      actions.notify(`"${d.date}" isn't a date. Use MM/DD/YYYY.`);
      return;
    }
    let amount: Minor;
    try {
      const out = d.outflow.trim() === '' ? ZERO : parseDecimal(d.outflow.replace(/[,$\s]/g, ''), fmt.decimals);
      const inn = d.inflow.trim() === '' ? ZERO : parseDecimal(d.inflow.replace(/[,$\s]/g, ''), fmt.decimals);
      amount = minor(inn - out);
    } catch {
      actions.notify('Outflow and inflow must be amounts, like 12.50.');
      return;
    }
    const categoryId: CategoryRef = d.category === '' ? null : d.category;
    if (t === null) {
      actions.run((p, ctx) =>
        addTransaction(p, ctx, {
          accountId: d.account,
          date,
          amount,
          ...(d.payee.trim() === '' ? {} : { payeeName: d.payee.trim() }),
          categoryId,
          ...(d.memo.trim() === '' ? {} : { memo: d.memo.trim() }),
        }),
      );
    } else {
      const isSplit = (t.subtransactions?.length ?? 0) > 0;
      const isTransfer = t.transferAccountId !== undefined;
      actions.run((p, ctx) =>
        editTransaction(p, ctx, {
          transactionId: t.id,
          patch: {
            date,
            memo: d.memo.trim() === '' ? null : d.memo.trim(),
            ...(isSplit ? {} : { amount }),
            ...(isSplit || isTransfer || d.payee.trim() === '' ? {} : { payeeName: d.payee.trim() }),
            ...(isSplit || isTransfer ? {} : { categoryId }),
          },
        }),
      );
    }
    setEditing(null);
  };

  const ids = [...selected];
  const categorize = (categoryId: Id): void => {
    actions.run((p, ctx) => {
      let current = p;
      const sets: ChangeSet[] = [];
      for (const id of ids) {
        const t = current.transactions.find((x) => x.id === id);
        if (!t || (t.subtransactions?.length ?? 0) > 0 || t.transferAccountId !== undefined) continue;
        const cmd = editTransaction(current, ctx, { transactionId: id, patch: { categoryId } });
        current = applyChanges(current, cmd.changes).plan;
        sets.push(cmd.changes);
      }
      return { label: `Categorize ${String(sets.length)} transactions`, changes: mergeChangeSets(...sets) };
    });
  };

  const showAccount = accountId === null;
  // check, flag, [account], date, payee, category, memo, outflow, inflow, cleared
  const columns = showAccount ? 10 : 9;
  const onBudgetView = account?.onBudget ?? true;
  const daysSince = account?.lastReconciledAt === undefined ? null : Math.max(0, Math.round((Date.parse(today) - Date.parse(account.lastReconciledAt.slice(0, 10))) / 86_400_000));

  return (
    <div className="hd-main full">
      <section className="hd-work rg-work" aria-label={account ? `${account.name} register` : 'All accounts register'}>
        <header className="rg-head">
          <div className="rg-title">
            <h1>
              {account ? account.name : 'All Accounts'}
              {account && actions.accountAction && (
                <button
                  type="button"
                  className={`hd-iconbtn rg-star${account.starred === true ? ' on' : ''}`}
                  aria-pressed={account.starred === true}
                  aria-label={account.starred === true ? `Unstar ${account.name}` : `Star ${account.name}`}
                  title={account.starred === true ? 'Starred: shown at the top of the sidebar' : 'Star to show at the top of the sidebar'}
                  onClick={() => {
                    actions.accountAction?.(account.id, account.starred === true ? 'unstar' : 'star');
                  }}
                >
                  <Icon name="star" />
                </button>
              )}
            </h1>
            <p className="muted">
              {account ? `${TYPE_LABEL[account.type] ?? account.type} · ${account.onBudget ? 'On budget' : 'Tracking'}${account.note ? ` · ${account.note}` : ''}` : 'Every cash, credit and tracking account'}
            </p>
          </div>
          <div className="rg-balances" aria-label="Balances">
            <div>
              <strong className="num">{money(total('cleared'))}</strong>
              <span>
                <Icon name="cleared" className="rg-ok" /> Cleared Balance
              </span>
            </div>
            <span className="rg-op" aria-hidden="true">
              +
            </span>
            <div>
              <strong className="num">{money(total('uncleared'))}</strong>
              <span>
                <Icon name="uncleared" /> Uncleared Balance
              </span>
            </div>
            <span className="rg-op" aria-hidden="true">
              =
            </span>
            <div className="rg-working">
              {/* Red only for an overdrawn cash account; a card or loan balance below zero is normal debt. */}
              <strong className={`num${account !== undefined && CASH_ACCOUNT_TYPES.includes(account.type) && total('working') < 0 ? ' neg' : ''}`}>{money(total('working'))}</strong>
              <span>Working Balance</span>
            </div>
          </div>
          {account && (
            <div className="rg-reconcile">
              <div className="rg-headactions">
                {actions.accountAction && (
                  <button type="button" className="hd-iconbtn" aria-label={`Edit ${account.name}`} title="Edit account" onClick={() => {
                    actions.accountAction?.(account.id, 'edit');
                  }}>
                    <Icon name="edit" />
                  </button>
                )}
                <button type="button" className="hd-secondary">
                  <Icon name="lock" /> Reconcile
                </button>
              </div>
              <small className="muted">{daysSince === null ? 'Never reconciled' : `Reconciled ${String(daysSince)} days ago`}</small>
            </div>
          )}
        </header>

        <div className="hd-toolbar rg-toolbar">
          <button type="button" className="hd-toolbtn" onClick={() => {
            setEditing(NEW);
            setSelected(new Set());
          }}>
            <Icon name="add" /> Add Transaction
          </button>
          <button type="button" className="hd-toolbtn" disabled title="Bank file import arrives in Phase 6">
            <Icon name="import" /> File Import
          </button>
          {account?.type === 'creditCard' && (
            <button type="button" className="hd-toolbtn">
              <Icon name="card" /> Record Payment
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="hd-chip rg-viewchip" aria-haspopup="menu">
            <Icon name="calendar" /> All dates <Icon name="chevronDown" />
          </button>
          <label className="rg-search">
            <Icon name="search" />
            <span className="visually-hidden">Search transactions</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search transactions"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
            <kbd>Ctrl+F</kbd>
          </label>
        </div>

        {unapproved.length > 0 && (
          <div className="rg-banner" role="status">
            <Icon name="info" size={20} />
            <span>
              <strong>
                {unapproved.length} {unapproved.length === 1 ? 'transaction needs' : 'transactions need'} approval.
              </strong>{' '}
              They already count in your plan; approve them once they look right.
            </span>
            <span className="spacer" />
            <button type="button" className="hd-secondary" aria-pressed={onlyUnapproved} onClick={() => {
              setOnlyUnapproved(!onlyUnapproved);
            }}>
              {onlyUnapproved ? 'Show all' : 'Review'}
            </button>
            <button type="button" className="hd-primary" onClick={() => {
              actions.run((p, ctx) => approveTransactions(p, ctx, { transactionIds: unapproved.map((t) => t.id) }));
              setOnlyUnapproved(false);
            }}>
              Approve all
            </button>
          </div>
        )}

        <div className="hd-grid rg-grid">
          <table aria-label={account ? `${account.name} transactions` : 'All transactions'} aria-multiselectable="true">
            <colgroup>
              <col className="check" />
              <col className="flag" />
              {showAccount && <col className="account" />}
              <col className="date" />
              <col className="payee" />
              <col className="category" />
              <col />
              <col className="money" />
              <col className="money" />
              <col className="cleared" />
            </colgroup>
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    className="hd-checkbox"
                    aria-label="Select all transactions"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) => {
                      setSelected(e.target.checked ? new Set(rows.map((t) => t.id)) : new Set());
                    }}
                  />
                </th>
                <th className="flag">
                  <span className="visually-hidden">Flag</span>
                  <Icon name="flag" />
                </th>
                {showAccount && <th>Account</th>}
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th>Memo</th>
                <th className="num">Outflow</th>
                <th className="num">Inflow</th>
                <th className="cleared">
                  <span className="visually-hidden">Cleared</span>
                  <Icon name="cleared" />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="rg-schedhead">
                <td colSpan={columns}>
                  <button type="button" aria-expanded={scheduledOpen} onClick={() => {
                    setScheduledOpen(!scheduledOpen);
                  }}>
                    <Icon name={scheduledOpen ? 'chevronDown' : 'chevronRight'} />
                    <Icon name="calendarClock" /> Scheduled
                    <span className="muted">({scheduled.length})</span>
                  </button>
                </td>
              </tr>
              {scheduledOpen && scheduled.length === 0 && (
                <tr className="rg-empty">
                  <td colSpan={columns}>No scheduled transactions. Repeating bills and paychecks you schedule show up here before their date.</td>
                </tr>
              )}

              {editing === NEW && (
                <EditRows
                  columns={columns}
                  showAccount={showAccount}
                  initial={draftFor(null)}
                  onBudget={onBudgetView}
                  accounts={plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true)}
                  categoryOptions={categoryOptions}
                  onCancel={() => {
                    setEditing(null);
                  }}
                  onSave={(d) => {
                    save(null, d);
                  }}
                />
              )}

              {rows.length === 0 && editing !== NEW && (
                <tr className="rg-empty">
                  <td colSpan={columns}>{query.trim() !== '' ? `No transactions match "${query.trim()}".` : 'No transactions yet. Add one, or import a bank file.'}</td>
                </tr>
              )}

              {rows.map((t) => {
                const acct = names.accounts.get(t.accountId);
                const onBudget = acct?.onBudget ?? true;
                if (editing === t.id) {
                  return (
                    <EditRows
                      key={t.id}
                      columns={columns}
                      showAccount={showAccount}
                      initial={draftFor(t)}
                      onBudget={onBudget}
                      locked={{ category: (t.subtransactions?.length ?? 0) > 0 || t.transferAccountId !== undefined, amount: (t.subtransactions?.length ?? 0) > 0, account: true }}
                      accounts={plan.accounts.filter((a) => a.deletedAt === undefined)}
                      categoryOptions={categoryOptions}
                      onCancel={() => {
                        setEditing(null);
                      }}
                      onSave={(d) => {
                        save(t, d);
                      }}
                    />
                  );
                }
                const isSelected = selected.has(t.id);
                const cat = categoryLabel(t, onBudget);
                const payee = t.payeeId === undefined ? '' : (names.payees.get(t.payeeId) ?? '');
                const subs = t.subtransactions ?? [];
                const cleared = CLEARED_ICON[t.cleared];
                return (
                  <Fragment key={t.id}>
                    <tr
                      className={`rg-row${t.approved === false ? ' unapproved' : ''}`}
                      aria-selected={isSelected}
                      onClick={(e) => {
                        if (e.target instanceof HTMLInputElement || (e.target instanceof Element && e.target.closest('button') !== null)) return;
                        if (e.ctrlKey || e.metaKey) {
                          toggle(t.id, true);
                          return;
                        }
                        setSelected(new Set([t.id]));
                        setEditing(t.id);
                      }}
                    >
                      <td className="check">
                        <input type="checkbox" className="hd-checkbox" aria-label={`Select ${payee || 'transaction'} on ${showDate(t.date)}`} checked={isSelected} onChange={() => {
                          toggle(t.id, true);
                        }} />
                      </td>
                      <td className="flag">
                        <button
                          type="button"
                          className={`rg-flag${t.flag ? ' on' : ''}`}
                          style={t.flag ? { color: FLAG_VAR[t.flag] } : undefined}
                          aria-label={t.flag ? `Flag: ${t.flag}. Remove flag` : 'Add flag'}
                          onClick={() => {
                            actions.run((p, ctx) => setFlag(p, ctx, { transactionIds: [t.id], flag: t.flag ? null : 'orange' }));
                          }}
                        >
                          <Icon name="flag" />
                        </button>
                      </td>
                      {showAccount && <td className="ellipsis">{acct?.name ?? ''}</td>}
                      <td className="date">{showDate(t.date)}</td>
                      <td className="ellipsis">
                        <span className="rg-payee">
                          {t.approved === false && <span className="rg-dot" title="Needs approval" />}
                          {t.transferAccountId !== undefined && <Icon name="transfer" className="rg-transfer" />}
                          <span className="rg-payeetext">{payee}</span>
                        </span>
                      </td>
                      <td className={`ellipsis${cat.muted ? ' muted' : ''}`}>
                        {subs.length > 0 && <Icon name="split" className="rg-inline" />}
                        {cat.text}
                      </td>
                      <td className="ellipsis muted">{t.memo ?? ''}</td>
                      <td className="num">{t.amount < 0 ? money(neg(t.amount)) : ''}</td>
                      <td className="num">{t.amount > 0 ? money(t.amount) : ''}</td>
                      <td className="cleared">
                        <button
                          type="button"
                          className={`rg-cleared ${t.cleared}`}
                          aria-label={`${cleared.label}${t.cleared === 'reconciled' ? '' : '. Toggle cleared'}`}
                          title={cleared.label}
                          disabled={t.cleared === 'reconciled'}
                          onClick={() => {
                            actions.run((p, ctx) => setCleared(p, ctx, { transactionIds: [t.id], cleared: NEXT_CLEARED[t.cleared] }));
                          }}
                        >
                          <Icon name={cleared.icon} />
                        </button>
                      </td>
                    </tr>
                    {subs.map((s) => (
                      <tr key={s.id} className="rg-sub" aria-selected={isSelected}>
                        <td className="check" />
                        <td />
                        {showAccount && <td />}
                        <td />
                        <td className="ellipsis muted">{s.payeeId !== undefined ? (names.payees.get(s.payeeId) ?? '') : ''}</td>
                        <td className="ellipsis">{s.categoryId === null ? '' : s.categoryId === READY_TO_ASSIGN ? 'Ready to Assign' : (names.categories.get(s.categoryId) ?? '')}</td>
                        <td className="ellipsis muted">{s.memo ?? ''}</td>
                        <td className="num">{s.amount < 0 ? money(neg(s.amount)) : ''}</td>
                        <td className="num">{s.amount > 0 ? money(s.amount) : ''}</td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {selected.size >= 2 && (
          <div className="rg-bulk" role="toolbar" aria-label="Selected transactions">
            <strong>{selected.size} selected</strong>
            <label className="rg-bulkselect">
              <Icon name="list" />
              <span className="visually-hidden">Categorize selected transactions</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value !== '') categorize(e.target.value);
                }}
              >
                <option value="">Categorize…</option>
                {categoryOptions.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="button" className="hd-toolbtn" onClick={() => {
              actions.run((p, ctx) => setFlag(p, ctx, { transactionIds: ids, flag: 'orange' }));
            }}>
              <Icon name="flag" /> Flag
            </button>
            <button type="button" className="hd-toolbtn" onClick={() => {
              actions.run((p, ctx) => approveTransactions(p, ctx, { transactionIds: ids }));
            }}>
              <Icon name="checkmark" /> Approve
            </button>
            <button type="button" className="hd-toolbtn rg-danger" onClick={() => {
              actions.run((p, ctx) => deleteTransactions(p, ctx, { transactionIds: ids }));
              setSelected(new Set());
              actions.notify(`Deleted ${String(ids.length)} transactions. Ctrl+Z brings them back.`);
            }}>
              <Icon name="dismiss" /> Delete
            </button>
            <button type="button" className="hd-iconbtn" aria-label="Clear selection" onClick={() => {
              setSelected(new Set());
            }}>
              <Icon name="dismiss" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** YNAB-style inline edit: the row becomes inputs, with Cancel / Save beneath. */
function EditRows({
  columns,
  showAccount,
  initial,
  onBudget,
  locked = { category: false, amount: false, account: false },
  accounts,
  categoryOptions,
  onCancel,
  onSave,
}: {
  columns: number;
  showAccount: boolean;
  initial: Draft;
  onBudget: boolean;
  locked?: { category: boolean; amount: boolean; account: boolean };
  accounts: readonly { id: Id; name: string }[];
  categoryOptions: { group: string; categories: { id: Id; name: string }[] }[];
  onCancel: () => void;
  onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setD((x) => ({ ...x, [k]: e.target.value }));
  };
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      onSave(d);
    }
  };
  return (
    <>
      <tr className="rg-edit" onKeyDown={keys}>
        <td className="check">
          <input type="checkbox" className="hd-checkbox" checked readOnly aria-label="Editing this transaction" />
        </td>
        <td />
        {showAccount && (
          <td>
            <select className="rg-input" aria-label="Account" value={d.account} disabled={locked.account} onChange={set('account')}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </td>
        )}
        <td>
          <input className="rg-input" aria-label="Date" value={d.date} onChange={set('date')} autoFocus />
        </td>
        <td>
          <input className="rg-input" aria-label="Payee" placeholder="Payee" value={d.payee} onChange={set('payee')} />
        </td>
        <td>
          <select className="rg-input" aria-label="Category" value={d.category} disabled={locked.category || !onBudget} onChange={set('category')}>
            <option value="">{onBudget ? 'Choose a category' : 'No category (tracking)'}</option>
            <option value={READY_TO_ASSIGN}>Inflow: Ready to Assign</option>
            {categoryOptions.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </td>
        <td>
          <input className="rg-input" aria-label="Memo" placeholder="Memo" value={d.memo} onChange={set('memo')} />
        </td>
        <td>
          <input className="rg-input num" aria-label="Outflow" placeholder="Outflow" inputMode="decimal" value={d.outflow} disabled={locked.amount} onChange={set('outflow')} />
        </td>
        <td>
          <input className="rg-input num" aria-label="Inflow" placeholder="Inflow" inputMode="decimal" value={d.inflow} disabled={locked.amount} onChange={set('inflow')} />
        </td>
        <td />
      </tr>
      <tr className="rg-editactions">
        <td colSpan={columns}>
          <span className="muted">Enter saves · Esc cancels</span>
          <button type="button" className="hd-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="hd-primary" onClick={() => {
            onSave(d);
          }}>
            Save
          </button>
        </td>
      </tr>
    </>
  );
}
