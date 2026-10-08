import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addMonths, formatMoney, parseDecimal, ZERO, type Minor, type MoneyFormat } from '@hafb/shared';
import { planBudget, setAssigned, type AccountRecord, type PlanData } from '@hafb/store';
import type { BackupInfo } from './ipc.ts';
import { session, todayLocal, type OpenPlan } from './session.ts';

// Phase 2 validation screen: proves open → edit → undo → persist → reopen on real hardware.
// Deliberately plain; Phase 3 builds the real Plan screen (YNAB's layout, our look).

function moneyFormat(plan: PlanData): MoneyFormat {
  const s = plan.settings;
  return { decimals: s.currencyDecimals, symbol: s.currencySymbol, placement: s.symbolPlacement, numberFormat: s.numberFormat };
}

const ms = (n: number): string => `${String(Math.round(n))} ms`;

export function PlanView({ open }: { open: OpenPlan }) {
  const { plan, info, history, month, timings } = open;
  const fmt = moneyFormat(plan);
  const money = (m: Minor): string => formatMoney(m, fmt);
  const today = todayLocal();
  const budget = planBudget(plan, { today, throughMonth: month });
  const monthState = budget.byMonth[month];
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [showReport, setShowReport] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return; // inputs keep their own text undo
      const key = e.key.toLowerCase();
      if (e.ctrlKey && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        session.undo();
      } else if (e.ctrlKey && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        session.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const groups = useMemo(
    () =>
      plan.categoryGroups
        .filter((g) => g.deletedAt === undefined)
        .toSorted((a, b) => Number(a.hidden === true) - Number(b.hidden === true) || a.sortOrder - b.sortOrder)
        .map((g) => ({
          group: g,
          categories: plan.categories.filter((c) => c.groupId === g.id && c.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder),
        })),
    [plan],
  );
  const accounts = plan.accounts.filter((a) => a.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const report = open.importReport;
  const rta = monthState?.readyToAssign;
  const undoText = history.undo.at(-1)?.label;
  const redoText = history.redo.at(-1)?.label;

  return (
    <main className="plan-view">
      <header className="plan-bar">
        <div>
          <strong>{plan.settings.name}</strong>
          <span className="muted"> {info.path}</span>
        </div>
        <div className="row">
          <button type="button" disabled={undoText === undefined} title={undoText === undefined ? 'Nothing to undo' : `Undo ${undoText} (Ctrl+Z)`} onClick={() => {
            session.undo();
          }}>
            Undo
          </button>
          <button type="button" disabled={redoText === undefined} title={redoText === undefined ? 'Nothing to redo' : `Redo ${redoText} (Ctrl+Shift+Z)`} onClick={() => {
            session.redo();
          }}>
            Redo
          </button>
          <button type="button" onClick={() => void session.saveCopy()}>
            Save a copy…
          </button>
          <button type="button" onClick={() => void session.listBackups().then(setBackups, (e: unknown) => {
            session.notify(String(e), 'error');
          })}>
            Backups…
          </button>
          <button type="button" onClick={() => void session.close()}>
            Close
          </button>
        </div>
      </header>

      <p className="muted small">
        File version {info.schemaVersion}
        {info.backupPath !== null && <> · backup made on open: {info.backupPath}</>} · loaded {timings.transactions.toLocaleString()} transactions: read{' '}
        {ms(timings.loadMs)}, decode {ms(timings.decodeMs)}, compute {ms(timings.computeMs)}
      </p>

      {backups && (
        <section className="panel">
          <h2>Backups</h2>
          {backups.length === 0 && <p className="muted">No backups yet.</p>}
          <table className="table">
            <tbody>
              {backups.map((b) => (
                <tr key={b.path}>
                  <td>{b.stamp}</td>
                  <td>{b.kind === 'beforeMigration' ? 'before an update' : b.kind === 'restore' ? 'before a restore' : 'on open'}</td>
                  <td className="num">{(b.sizeBytes / 1024).toFixed(0)} KB</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Replace the plan with the backup from ${b.stamp}? The current plan is backed up first.`)) {
                          setBackups(null);
                          void session.restore(b);
                        }
                      }}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => {
            setBackups(null);
          }}>
            Hide
          </button>
        </section>
      )}

      {report && showReport && (
        <section className="panel">
          <h2>Import report</h2>
          <p>
            {report.counts.accounts} accounts, {report.counts.categories} categories, {report.counts.transactions.toLocaleString()} transactions ({report.counts.transferPairs}{' '}
            transfer pairs, {report.counts.splits} splits), {report.counts.payees} payees, {report.counts.months} months of assignments.
          </p>
          <p>Account types were inferred (the export doesn't include them):</p>
          <ul>
            {report.accounts.map((a) => (
              <li key={a.name}>
                {a.name}: {a.type} ({a.reason})
              </li>
            ))}
          </ul>
          {report.targetsToReenter.length > 0 && <p>Targets aren't exported: {report.targetsToReenter.length} categories need their targets re-entered.</p>}
          {report.scheduledWithoutRepeat > 0 && <p>{report.scheduledWithoutRepeat} upcoming transaction(s) were imported as one-offs.</p>}
          {report.warnings.length > 0 && (
            <ul className="bad">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => {
            setShowReport(false);
          }}>
            Hide
          </button>
        </section>
      )}

      <div className="month-bar">
        <button type="button" aria-label="Previous month" onClick={() => {
          session.setMonth(addMonths(month, -1));
        }}>
          ◀
        </button>
        <strong>{month}</strong>
        <button type="button" aria-label="Next month" onClick={() => {
          session.setMonth(addMonths(month, 1));
        }}>
          ▶
        </button>
        <span className={rta !== undefined && rta < 0 ? 'rta bad' : 'rta'}>
          Ready to Assign: <strong>{rta === undefined ? '—' : money(rta)}</strong>
        </span>
      </div>

      <div className="plan-columns">
        <section className="panel">
          <h2>Accounts</h2>
          <AccountTable accounts={accounts} balances={budget.accountBalances} money={money} />
        </section>

        <section className="panel grow">
          <h2>Categories</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Assigned</th>
                <th className="num">Activity</th>
                <th className="num">Available</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ group, categories }) => (
                <GroupRows key={group.id} name={group.name} hidden={group.hidden === true}>
                  {categories.map((c) => {
                    const cm = monthState?.categories[c.id];
                    return (
                      <tr key={c.id} className={c.hidden === true ? 'muted' : undefined}>
                        <td>{c.name}</td>
                        <td className="num">
                          <AssignedInput categoryName={c.name} value={cm?.assigned ?? ZERO} decimals={fmt.decimals} money={money} onCommit={(amount) => {
                            session.run((p, ctx) => setAssigned(p, ctx, { month, categoryId: c.id, amount }));
                          }} />
                        </td>
                        <td className="num">{money(cm?.activity ?? ZERO)}</td>
                        <td className={`num ${(cm?.available ?? 0) < 0 ? 'bad' : ''}`}>{money(cm?.available ?? ZERO)}</td>
                      </tr>
                    );
                  })}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function GroupRows({ name, hidden, children }: { name: string; hidden: boolean; children: ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <th colSpan={4}>
          {name}
          {hidden && <span className="muted"> (hidden)</span>}
        </th>
      </tr>
      {children}
    </>
  );
}

function AccountTable({
  accounts,
  balances,
  money,
}: {
  accounts: AccountRecord[];
  balances: Record<string, { working: Minor; cleared: Minor }>;
  money: (m: Minor) => string;
}) {
  const sections: [string, AccountRecord[]][] = [
    ['On budget', accounts.filter((a) => a.onBudget && a.closed !== true)],
    ['Off budget', accounts.filter((a) => !a.onBudget && a.closed !== true)],
    ['Closed', accounts.filter((a) => a.closed === true)],
  ];
  return (
    <table className="table">
      <tbody>
        {sections
          .filter(([, list]) => list.length > 0)
          .map(([title, list]) => (
            <GroupAccounts key={title} title={title}>
              {list.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="muted">{a.type}</td>
                  <td className="num">{money(balances[a.id]?.working ?? ZERO)}</td>
                </tr>
              ))}
            </GroupAccounts>
          ))}
      </tbody>
    </table>
  );
}

function GroupAccounts({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <th colSpan={3}>{title}</th>
      </tr>
      {children}
    </>
  );
}

/** Assigned cell: shows the amount; edit as a plain decimal; Enter commits, Esc cancels. */
function AssignedInput({
  categoryName,
  value,
  decimals,
  money,
  onCommit,
}: {
  categoryName: string;
  value: Minor;
  decimals: number;
  money: (m: Minor) => string;
  onCommit: (amount: Minor) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Enter and Esc finish the edit themselves; the blur that follows must not commit again.
  const finished = useRef(false);
  const plain = (m: Minor): string => {
    const digits = String(Math.abs(m)).padStart(decimals + 1, '0');
    const text = decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
    return m < 0 ? `-${text}` : text;
  };
  const commit = (): void => {
    if (draft === null || finished.current) return;
    try {
      const amount = parseDecimal(draft.trim() === '' ? '0' : draft.replace(/[,$\s]/g, ''), decimals);
      setDraft(null);
      if (amount !== value) onCommit(amount);
    } catch {
      session.notify(`"${draft}" isn't an amount.`, 'error');
    }
  };
  return (
    <input
      className="money-input"
      aria-label={`Assigned for ${categoryName}`}
      value={draft ?? money(value)}
      onFocus={(e) => {
        finished.current = false;
        setDraft(plain(value));
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
          finished.current = true;
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          finished.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

