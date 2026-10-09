import { Icon, type IconName } from './Icon.tsx';
import type { MoneyState } from './moneyState.ts';
import styles from './Pill.module.css';

export type { MoneyState };

const STATE_ICON: Partial<Record<MoneyState, IconName>> = {
  funded: 'checkmark',
  underfunded: 'clock',
  overspent: 'warning',
  creditOverspent: 'warning',
  snoozed: 'snooze',
};

const STATE_LABEL: Record<MoneyState, string> = {
  funded: 'funded',
  underfunded: 'underfunded',
  overspent: 'overspent',
  creditOverspent: 'overspent on credit',
  zero: 'empty',
  snoozed: 'snoozed',
};

export interface PillProps {
  state: MoneyState;
  /** The formatted amount (the caller formats with the plan's currency settings). */
  children: string;
  /** Overspent on a credit card: a card icon, always visible. */
  credit?: boolean;
  /** Upcoming scheduled transactions this month won't be covered: a calendar icon, always visible. */
  upcoming?: boolean;
  /** Plain-language explanation (target message), shown as a tooltip. */
  title?: string;
}

/**
 * The Available pill (DESIGN.md "Money-State Colour"). State is also carried by an icon and outline
 * when the user turns on Differentiate without color, and spoken for screen readers.
 */
export function Pill({ state, children, credit = false, upcoming = false, title }: PillProps) {
  const icon = STATE_ICON[state];
  return (
    <span className={styles.pill} data-state={state} title={title}>
      {credit && <Icon name="card" />}
      {upcoming && <Icon name="calendar" />}
      {icon && !upcoming && <Icon name={icon} className={styles.stateIcon} />}
      <span className="visually-hidden">{STATE_LABEL[state]}: </span>
      {children}
    </span>
  );
}
