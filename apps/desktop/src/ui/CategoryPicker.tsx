import { formatMoney, type Minor, type MoneyFormat } from '@hafb/shared';
import type { ComboGroup } from './comboModel.ts';
import { Combobox } from './Combobox.tsx';
import { cx } from './cx.ts';
import styles from './Pickers.module.css';

export interface CategoryPickerProps {
  /** From `categoryPickerData(...)`. */
  groups: readonly ComboGroup[];
  /** Available per option id; options without an entry show no amount (e.g. Split). */
  available: ReadonlyMap<string, Minor>;
  format: MoneyFormat;
  value: string | null;
  onChange: (categoryId: string) => void;
  size?: 'compact' | 'medium';
  autoFocus?: boolean;
  initialQuery?: string;
  disabled?: boolean;
}

/** Category field: grouped like the plan, each category with what's Available this month. */
export function CategoryPicker({ groups, available, format, value, onChange, size, autoFocus, initialQuery, disabled }: CategoryPickerProps) {
  return (
    <Combobox
      groups={groups}
      value={value}
      onChange={onChange}
      label="Category"
      placeholder="Category"
      renderMeta={(option) => {
        const amount = available.get(option.id);
        if (amount === undefined) return null;
        return <span className={cx(styles.amount, amount < 0 && styles.negative, amount === 0 && styles.zero)}>{formatMoney(amount, format)}</span>;
      }}
      {...(size ? { size } : {})}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      {...(initialQuery === undefined ? {} : { initialQuery })}
      {...(disabled === undefined ? {} : { disabled })}
    />
  );
}
