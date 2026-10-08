// One money formatter per screen render: the plan's currency settings, and Hide Amounts.
import { formatMoney, type Minor, type MoneyFormat } from '@hafb/shared';

/** What a masked amount shows (Hide Amounts). Screen readers hear "amount hidden". */
export const HIDDEN_AMOUNT = '•••••';

export type MoneyText = (m: Minor) => string;

export function moneyText(fmt: MoneyFormat, hidden: boolean): MoneyText {
  if (!hidden) return (m) => formatMoney(m, fmt);
  const masked = fmt.placement === 'before' ? `${fmt.symbol}${HIDDEN_AMOUNT}` : fmt.placement === 'after' ? `${HIDDEN_AMOUNT} ${fmt.symbol}` : HIDDEN_AMOUNT;
  return () => masked;
}
