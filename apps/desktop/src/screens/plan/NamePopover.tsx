// The small name form YNAB opens for adding and renaming categories and groups (S4.2): a name field,
// OK/Cancel, and optional actions (Hide, Delete) along the bottom.
import { useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import type { IconName } from '../../ui/Icon.tsx';
import { Popover } from '../../ui/Popover.tsx';
import type { Rect } from '../../ui/position.ts';
import { TextInput } from '../../ui/TextInput.tsx';
import styles from './PlanEditors.module.css';

export interface NameAction {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
}

export interface NamePopoverProps {
  anchor: Rect;
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
  actions?: readonly NameAction[];
  onAction?: (id: string) => void;
}

export function NamePopover({ anchor, title, label, initial, submitLabel, onSubmit, onClose, actions = [], onAction }: NamePopoverProps) {
  const [name, setName] = useState(initial);
  const valid = name.trim() !== '';
  const submit = (): void => {
    if (!valid) return;
    onClose();
    if (name.trim() !== initial.trim()) onSubmit(name.trim());
  };
  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-start" role="dialog" label={title} className={styles.popover}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          label={label}
          hideLabel
          size="compact"
          value={name}
          autoFocus
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <div className={styles.row}>
          {actions.map((a) => (
            <Button
              key={a.id}
              size="small"
              variant={a.danger === true ? 'danger' : 'secondary'}
              {...(a.icon ? { icon: a.icon } : {})}
              onClick={() => {
                onClose();
                onAction?.(a.id);
              }}
            >
              {a.label}
            </Button>
          ))}
          <span className={styles.spacer} />
          <Button size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="primary" type="submit" disabled={!valid}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
