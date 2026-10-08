import { useState, type ReactNode } from 'react';
import { CASH_ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, LOAN_ACCOUNT_TYPES, type AccountType } from '@hafb/engine';
import { minor, type ISODate, type Minor } from '@hafb/shared';
import { planBudget, type AccountRecord, type PlanData } from '@hafb/store';
import { Icon } from '../ui/Icon.tsx';
import type { Screen } from './DesignApp.tsx';

const SECTIONS: { key: string; title: string; types: readonly AccountType[] }[] = [
  { key: 'cash', title: 'Cash', types: CASH_ACCOUNT_TYPES },
  { key: 'credit', title: 'Credit', types: CREDIT_ACCOUNT_TYPES },
  { key: 'loans', title: 'Loans', types: LOAN_ACCOUNT_TYPES },
  { key: 'tracking', title: 'Tracking', types: ['asset', 'liability'] },
];

export function Sidebar({
  plan,
  today,
  screen,
  navigate,
  money,
  footer,
}: {
  plan: PlanData;
  today: ISODate;
  screen: Screen;
  navigate: (s: Screen) => void;
  money: (m: Minor) => string;
  /** Mockup-only display options (theme, without colour). */
  footer?: ReactNode;
}) {
  const balances = planBudget(plan, { today }).accountBalances;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const open = plan.accounts.filter((a) => a.deletedAt === undefined && a.closed !== true).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const balance = (a: AccountRecord): Minor => balances[a.id]?.working ?? minor(0);
  const starred = open.filter((a) => a.starred === true);
  const sections = [
    ...(starred.length > 0 ? [{ key: 'starred', title: 'Starred', accounts: starred }] : []),
    ...SECTIONS.map((s) => ({ key: s.key, title: s.title, accounts: open.filter((a) => s.types.includes(a.type)) })),
  ].filter((s) => s.accounts.length > 0);
  const current = screen.kind === 'register' ? screen.accountId : undefined;

  return (
    <nav className="hd-sidebar" aria-label="Plan navigation">
      <button type="button" className="hd-planmenu" aria-haspopup="menu">
        <span className="hd-mark" aria-hidden="true">
          HAFB
        </span>
        <span>
          <strong>{plan.settings.name}</strong>
          <small>Sample data · local file</small>
        </span>
        <Icon name="chevronDown" style={{ marginLeft: 'auto' }} />
      </button>

      <div className="hd-nav">
        <button type="button" className="hd-navitem" aria-current={screen.kind === 'plan' ? 'page' : undefined} onClick={() => {
          navigate({ kind: 'plan' });
        }}>
          <Icon name="plan" size={20} /> Plan
        </button>
        <button type="button" className="hd-navitem" aria-current={screen.kind === 'reflect' ? 'page' : undefined} onClick={() => {
          navigate({ kind: 'reflect' });
        }}>
          <Icon name="reflect" size={20} /> Reflect
        </button>
        <button type="button" className="hd-navitem" aria-current={screen.kind === 'register' && screen.accountId === null ? 'page' : undefined} onClick={() => {
          navigate({ kind: 'register', accountId: null });
        }}>
          <Icon name="accounts" size={20} /> All Accounts
        </button>
      </div>

      <div className="hd-accounts">
        {sections.map((s) => {
          const total = minor(s.accounts.reduce((sum, a) => sum + balance(a), 0));
          const isCollapsed = collapsed[s.key] === true;
          return (
            <div className="hd-accgroup" key={s.key}>
              <button type="button" className="head" aria-expanded={!isCollapsed} onClick={() => {
                setCollapsed((c) => ({ ...c, [s.key]: !isCollapsed }));
              }}>
                <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} />
                {s.title}
                {s.key !== 'starred' && <span className={`num${s.key === 'cash' && total < 0 ? ' neg' : ''}`}>{money(total)}</span>}
              </button>
              {!isCollapsed &&
                s.accounts.map((a) => (
                  <button key={`${s.key}-${a.id}`} type="button" className="hd-account" aria-current={current === a.id ? 'page' : undefined} onClick={() => {
                    navigate({ kind: 'register', accountId: a.id });
                  }}>
                    <span>{a.name}</span>
                    <span className={`num${CASH_ACCOUNT_TYPES.includes(a.type) && balance(a) < 0 ? ' neg' : ''}`}>{money(balance(a))}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      {footer}
      <button type="button" className="hd-addaccount">
        <Icon name="add" /> Add Account
      </button>
    </nav>
  );
}
