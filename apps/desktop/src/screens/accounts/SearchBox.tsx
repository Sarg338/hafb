// The register's search box with YNAB's suggestion list (R-14, S8.5). The list is the pickers'
// listbox (Combobox styles): arrows move, Enter or a click picks, Escape closes the list and a
// second Escape clears the search. Typing without picking searches as before.
import { useId, useRef, useState, type RefObject } from 'react';
import comboStyles from '../../ui/Combobox.module.css';
import { cx } from '../../ui/cx.ts';
import { Popover } from '../../ui/Popover.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import type { SearchSuggestion } from './searchSuggest.ts';
import styles from './RegisterScreen.module.css';

export interface SearchBoxProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (text: string) => void;
  suggest: (text: string) => SearchSuggestion[];
  placeholder: string;
  invalid: boolean;
  className?: string;
}

export function SearchBox({ inputRef, value, onChange, suggest, placeholder, invalid, className }: SearchBoxProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = open ? suggest(value) : [];
  const shown = list.length > 0;
  const optionId = (i: number): string => `${baseId}-opt-${String(i)}`;

  const choose = (s: SearchSuggestion | undefined): void => {
    if (!s) return;
    onChange(s.value);
    setActive(-1);
    // The Income hint waits for a month; anything else is a finished criterion.
    setOpen(s.key === 'Income:');
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className={cx(styles.search, className)}>
      <TextInput
        ref={inputRef}
        label="Search transactions"
        hideLabel
        size="compact"
        prefix="search"
        placeholder={placeholder}
        value={value}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid ? true : undefined}
        title="Search: Payee:, Category:, Memo:, Account:, Outflow: >=30, Before:, After:, On:, Flag:, Income:, is:unapproved…"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!shown) {
              setOpen(true);
              return;
            }
            // -1 is the text itself: arrows cycle through it and the rows.
            const next = active + (e.key === 'ArrowDown' ? 1 : -1);
            setActive(next >= list.length ? -1 : next < -1 ? list.length - 1 : next);
            return;
          }
          if (e.key === 'Enter' && shown && active >= 0) {
            e.preventDefault();
            choose(list[active]);
            return;
          }
          if (e.key === 'Escape') {
            if (shown) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setActive(-1);
            } else if (value !== '') {
              e.preventDefault();
              onChange('');
            }
          }
        }}
      />
      <Popover open={shown} onClose={() => { setOpen(false); }} anchor={wrapRef} placement="bottom-end" role="presentation" gap={2} className={styles.searchPopover}>
        <div id={listId} role="listbox" aria-label="Search suggestions" className={comboStyles.list}>
          {list.map((s, i) => (
            <div
              key={s.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              className={comboStyles.option}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onMouseMove={() => {
                if (i !== active) setActive(i);
              }}
              onClick={() => {
                choose(s);
              }}
            >
              <span className={styles.searchKey}>{s.key}</span>
              <span className={comboStyles.optionLabel}>{s.text}</span>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
