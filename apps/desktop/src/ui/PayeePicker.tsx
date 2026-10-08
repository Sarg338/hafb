import type { ComboGroup } from './comboModel.ts';
import { Combobox } from './Combobox.tsx';

export interface PayeePickerProps {
  /** From `payeeGroups(plan)`: Payments & Transfers, then Saved Payees. */
  groups: readonly ComboGroup[];
  value: string | null;
  onChange: (payeeId: string) => void;
  /** Typing a new name offers “Create payee …”; the caller adds the payee. */
  onCreate?: (name: string) => void;
  size?: 'compact' | 'medium';
  autoFocus?: boolean;
  initialQuery?: string;
  disabled?: boolean;
}

/** Payee field: search saved payees and transfer targets, or create a new payee. */
export function PayeePicker({ groups, value, onChange, onCreate, size, autoFocus, initialQuery, disabled }: PayeePickerProps) {
  return (
    <Combobox
      groups={groups}
      value={value}
      onChange={onChange}
      createNoun="payee"
      label="Payee"
      placeholder="Payee"
      {...(onCreate ? { onCreate } : {})}
      {...(size ? { size } : {})}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      {...(initialQuery === undefined ? {} : { initialQuery })}
      {...(disabled === undefined ? {} : { disabled })}
    />
  );
}
