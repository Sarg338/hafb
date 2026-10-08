import { CASH_ACCOUNT_TYPES, CREDIT_ACCOUNT_TYPES, LOAN_ACCOUNT_TYPES, type AccountType } from '@hafb/engine';
import { minor, type ISODate, type Minor } from '@hafb/shared';
import { planBudget, type AccountRecord, type PlanData } from '@hafb/store';
import { cx } from '../ui/cx.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { ContextMenu, MenuButton, type MenuItem } from '../ui/Menu.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { moneyFormat } from '../screens/plan/planModel.ts';
import { prefs, usePrefs } from './prefs.ts';
import { moneyText } from '../screens/shared/money.ts';
import { stepAccount } from '../screens/accounts/accountsModel.ts';
import { useAccountDrag } from './useAccountDrag.ts';
import { formatRoute, type Route } from './router.ts';
import styles from './Sidebar.module.css';

interface Section {
  id: string;
  title: string;
  icon: IconName;
  types?: readonly AccountType[];
  collapsedByDefault?: boolean;
}

const SECTIONS: readonly Section[] = [
  { id: 'starred', title: 'Starred', icon: 'star' },
  { id: 'cash', title: 'Cash', icon: 'money', types: CASH_ACCOUNT_TYPES },
  { id: 'credit', title: 'Credit', icon: 'card', types: CREDIT_ACCOUNT_TYPES },
  { id: 'loans', title: 'Loans', icon: 'accounts', types: LOAN_ACCOUNT_TYPES },
  { id: 'tracking', title: 'Tracking', icon: 'trending', types: ['asset', 'liability'] },
  { id: 'closed', title: 'Closed', icon: 'lock', collapsedByDefault: true },
];

export interface SidebarProps {
  plan: PlanData;
  /** Second line under the plan name ("Local file", "Sample data (browser preview)"). */
  subtitle: string;
  today: ISODate;
  route: Route;
  planMenu: readonly MenuItem[];
  onPlanMenu: (id: string) => void;
  viewMenu: readonly MenuItem[];
  onViewMenu: (id: string) => void;
  onAddAccount: () => void;
  /** Row menu actions on an account (edit, star, move, close, reopen). */
  onAccountAction: (accountId: string, action: AccountAction) => void;
  /** A dragged account's new full order. */
  onReorder: (accountIds: string[]) => void;
}

export type AccountAction = 'edit' | 'star' | 'unstar' | 'up' | 'down' | 'close' | 'reopen';
const ACCOUNT_ACTIONS: readonly string[] = ['edit', 'star', 'unstar', 'up', 'down', 'close', 'reopen'];
const isAccountAction = (x: string): x is AccountAction => ACCOUNT_ACTIONS.includes(x);

/** A nav link: full label when expanded; icon with a tooltip in the rail. */
function NavLink({ to, icon, label, current, rail }: { to: Route; icon: IconName; label: string; current: boolean; rail: boolean }) {
  const { triggerProps, tooltip } = useTooltip(label, { describe: false });
  return (
    <>
      <a
        href={formatRoute(to)}
        className={styles.navitem}
        aria-current={current ? 'page' : undefined}
        aria-label={rail ? label : undefined}
        {...(rail ? triggerProps : {})}
      >
        <Icon name={icon} size={20} />
        {!rail && label}
      </a>
      {rail && tooltip}
    </>
  );
}

export function Sidebar({ plan, subtitle, today, route, planMenu, onPlanMenu, viewMenu, onViewMenu, onAddAccount, onAccountAction, onReorder }: SidebarProps) {
  const p = usePrefs();
  const rail = p.sidebarCollapsed;
  const fmt = moneyFormat(plan);
  const { hideAmounts } = usePrefs();
  const money = moneyText(fmt, hideAmounts);
  const balances = planBudget(plan, { today }).accountBalances;
  const live = plan.accounts.filter((a) => a.deletedAt === undefined).toSorted((a, b) => a.sortOrder - b.sortOrder);
  const open = live.filter((a) => a.closed !== true);
  const balance = (a: AccountRecord): Minor => balances[a.id]?.working ?? minor(0);
  const membersOf = (s: Section): AccountRecord[] => {
    if (s.id === 'starred') return open.filter((a) => a.starred === true);
    if (s.id === 'closed') return live.filter((a) => a.closed === true);
    return open.filter((a) => s.types?.includes(a.type) === true);
  };
  const sections = SECTIONS.map((s) => ({ ...s, accounts: membersOf(s) })).filter((s) => s.accounts.length > 0);
  const isCollapsed = (s: Section): boolean => (s.collapsedByDefault === true ? !p.expandedSections.includes(s.id) : p.collapsedSections.includes(s.id));
  const currentAccount = route.kind === 'accounts' ? route.accountId : undefined;
  const { containerRef: dragContainer, onPointerDown: onDragStart, justDragged, line: dropLine } = useAccountDrag(plan, onReorder);
  const menuFor = (a: AccountRecord): MenuItem[] => [
    { id: 'edit', label: 'Edit account…', icon: 'edit' },
    a.starred === true ? { id: 'unstar', label: 'Unstar', icon: 'star' } : { id: 'star', label: 'Star', icon: 'star' },
    { id: 'sep1', label: '', separator: true },
    { id: 'up', label: 'Move up', icon: 'chevronUp', disabled: stepAccount(plan, a.id, -1) === null },
    { id: 'down', label: 'Move down', icon: 'chevronDown', disabled: stepAccount(plan, a.id, 1) === null },
    { id: 'sep2', label: '', separator: true },
    a.closed === true ? { id: 'reopen', label: 'Reopen account', icon: 'history' } : { id: 'close', label: 'Close account…', icon: 'lock', danger: true },
  ];

  return (
    <nav className={cx(styles.sidebar, rail && styles.rail)} aria-label="Plan navigation">
      <div className={styles.top}>
        <MenuButton
          items={planMenu}
          onSelect={onPlanMenu}
          label={`${plan.settings.name} menu`}
          trigger={(props) => (
            <button type="button" className={styles.planmenu} {...props} aria-label={rail ? `${plan.settings.name} menu` : undefined}>
              <span className={styles.mark} aria-hidden="true">
                HAFB
              </span>
              {!rail && (
                <>
                  <span className={styles.planText}>
                    <strong>{plan.settings.name}</strong>
                    <small>{subtitle}</small>
                  </span>
                  <Icon name="chevronDown" className={styles.chevron} />
                </>
              )}
            </button>
          )}
        />
      </div>

      <div className={styles.nav}>
        <NavLink to={{ kind: 'plan' }} icon="plan" label="Plan" current={route.kind === 'plan'} rail={rail} />
        <NavLink to={{ kind: 'reflect' }} icon="reflect" label="Reflect" current={route.kind === 'reflect'} rail={rail} />
        <NavLink to={{ kind: 'accounts', accountId: null }} icon="accounts" label="All Accounts" current={route.kind === 'accounts' && route.accountId === null} rail={rail} />
      </div>

      <div className={styles.accounts} aria-label="Accounts" ref={dragContainer}>
        {dropLine !== null && <div className={styles.dropLine} style={{ top: dropLine }} aria-hidden="true" />}
        {!rail && sections.length === 0 && <p className={styles.empty}>No accounts yet. Add one to start tracking where your money lives.</p>}
        {!rail &&
          sections.map((s) => {
            const total = minor(s.accounts.reduce((sum, a) => sum + balance(a), 0));
            const collapsed = isCollapsed(s);
            // Red is for money that needs action: only an overdrawn cash account (DESIGN.md "Red Means Act").
            const overdrawn = (a: AccountRecord): boolean => CASH_ACCOUNT_TYPES.includes(a.type) && balance(a) < 0;
            return (
              <div className={styles.group} key={s.id}>
                <button
                  type="button"
                  className={styles.head}
                  aria-expanded={!collapsed}
                  onClick={() => {
                    prefs.toggleSection(s.id, s.collapsedByDefault === true);
                  }}
                >
                  <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} />
                  {s.title}
                  {s.id !== 'starred' && s.id !== 'closed' && <span className={cx(styles.num, s.id === 'cash' && total < 0 && styles.neg)}>{money(total)}</span>}
                </button>
                {!collapsed &&
                  s.accounts.map((a) => (
                    <ContextMenu
                      key={`${s.id}-${a.id}`}
                      items={menuFor(a)}
                      label={a.name}
                      onSelect={(action) => {
                        if (isAccountAction(action)) onAccountAction(a.id, action);
                      }}
                    >
                      <a
                        href={formatRoute({ kind: 'accounts', accountId: a.id })}
                        className={styles.account}
                        aria-current={currentAccount === a.id ? 'page' : undefined}
                        data-account-id={a.id}
                        data-section={s.id}
                        draggable={false}
                        onPointerDown={onDragStart}
                        onClick={(e) => {
                          if (justDragged.current) e.preventDefault();
                        }}
                      >
                        {a.starred === true && s.id !== 'starred' && <span className="visually-hidden">Starred. </span>}
                        <span className={styles.accountName}>{a.name}</span>
                        <span className={cx(styles.num, overdrawn(a) && styles.neg)}>{money(balance(a))}</span>
                      </a>
                    </ContextMenu>
                  ))}
              </div>
            );
          })}
      </div>

      <div className={styles.footer}>
        <MenuButton
          items={viewMenu}
          onSelect={onViewMenu}
          label="View options"
          placement="top-start"
          trigger={(props) => (
            <button type="button" className={styles.navitem} {...props} aria-label={rail ? 'View options' : undefined}>
              <Icon name="settings" size={20} />
              {!rail && 'View options'}
            </button>
          )}
        />
        <button
          type="button"
          className={styles.navitem}
          aria-expanded={!rail}
          aria-label={rail ? 'Expand sidebar' : undefined}
          onClick={() => {
            prefs.update({ sidebarCollapsed: !rail });
          }}
        >
          <Icon name={rail ? 'chevronRight' : 'chevronLeft'} size={20} />
          {!rail && 'Collapse sidebar'}
        </button>
      </div>
      <button type="button" className={styles.addaccount} onClick={onAddAccount} aria-label={rail ? 'Add Account' : undefined}>
        <Icon name="add" /> {!rail && 'Add Account'}
      </button>
    </nav>
  );
}
