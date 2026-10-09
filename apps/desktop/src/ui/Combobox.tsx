import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Combobox.module.css';
import { CREATE_ID, createOption, filterGroups, flatten, move, type ComboGroup, type ComboOption, type MatchedOption, type MoveKey } from './comboModel.ts';
import { cx } from './cx.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Popover } from './Popover.tsx';

export interface ComboboxProps {
  groups: readonly ComboGroup[];
  /** The selected option id (null = nothing chosen). */
  value: string | null;
  onChange: (id: string) => void;
  /** When given, typing a new name offers "Create <noun> “X”". */
  onCreate?: (label: string) => void;
  createNoun?: string;
  /** Accessible name (the field has no visible label in grids). */
  label: string;
  placeholder?: string;
  /** Right-side content per option, e.g. a category's Available amount. */
  renderMeta?: (option: ComboOption) => ReactNode;
  /** 'compact' = the register's 26 px inline input; 'medium' = 32 px form field. */
  size?: 'compact' | 'medium';
  disabled?: boolean;
  autoFocus?: boolean;
  /** Open on mount with this text typed (gallery deep links, focused editing). */
  initialQuery?: string;
  /** A command under the list (the payee picker's "Manage Payees", as in YNAB). */
  footerAction?: { label: string; icon?: IconName; onSelect: () => void };
  className?: string;
}

const NAV_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']);
const isMoveKey = (key: string): key is MoveKey => NAV_KEYS.has(key) || key === 'Home' || key === 'End';

function Highlight({ option }: { option: MatchedOption }) {
  if (!option.match) return <>{option.label}</>;
  const [start, end] = option.match;
  return (
    <>
      {option.label.slice(0, start)}
      <mark className={styles.mark}>{option.label.slice(start, end)}</mark>
      {option.label.slice(end)}
    </>
  );
}

/**
 * Grouped, searchable combobox (WAI-ARIA combobox with a listbox popup). Typing filters with
 * ranked matches; arrows move; Enter or Tab picks the active option (Tab then moves on, as in the
 * register); Escape closes, a second Escape reverts the text; clicking away reverts.
 */
export function Combobox({
  groups,
  value,
  onChange,
  onCreate,
  createNoun = 'item',
  label,
  placeholder,
  renderMeta,
  size = 'compact',
  disabled = false,
  autoFocus = false,
  initialQuery,
  footerAction,
  className,
}: ComboboxProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => groups.flatMap((g) => g.options).find((o) => o.id === value) ?? null, [groups, value]);

  const [open, setOpen] = useState(initialQuery !== undefined);
  const [query, setQuery] = useState(initialQuery ?? '');
  /** True once the user has typed since the last selection: the text is a search, not the value. */
  const [dirty, setDirty] = useState(initialQuery !== undefined);
  const [activeId, setActiveId] = useState<string | null>(null);

  const matched = useMemo(() => filterGroups(groups, dirty ? query : ''), [groups, dirty, query]);
  const list = useMemo(() => flatten(matched), [matched]);
  const create = useMemo(() => (onCreate && dirty ? createOption(query, list, createNoun) : null), [onCreate, dirty, query, list, createNoun]);
  const navigable: ComboOption[] = useMemo(() => (create ? [...list, create] : list), [list, create]);
  const domIds = useMemo(() => new Map(navigable.map((o, i) => [o.id, `${baseId}-opt-${String(i)}`])), [navigable, baseId]);
  const domId = (id: string): string => domIds.get(id) ?? `${baseId}-opt-none`;

  // Keep the active option valid as the list changes: the first match while typing,
  // the current value when opening without typing.
  const effectiveActive = activeId !== null && navigable.some((o) => o.id === activeId) ? activeId : dirty ? (navigable.find((o) => o.disabled !== true)?.id ?? null) : (selected?.id ?? null);

  useEffect(() => {
    if (!open || effectiveActive === null) return;
    const el = domIds.get(effectiveActive);
    if (el !== undefined) document.getElementById(el)?.scrollIntoView({ block: 'nearest' });
  }, [open, effectiveActive, domIds]);

  const text = dirty ? query : (selected?.label ?? '');

  const close = (revert: boolean): void => {
    setOpen(false);
    setActiveId(null);
    if (revert) {
      setDirty(false);
      setQuery('');
    }
  };

  const choose = (id: string | null): void => {
    if (id === null) return;
    if (id === CREATE_ID && create) {
      onCreate?.(create.createLabel);
    } else {
      const option = navigable.find((o) => o.id === id);
      if (!option || option.disabled === true) return;
      onChange(id);
    }
    close(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (isMoveKey(e.key) && (NAV_KEYS.has(e.key) || open)) {
      // Home/End move the caret unless the list is open.
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveId(move(navigable, effectiveActive, e.key));
      return;
    }
    if (e.key === 'Enter') {
      if (open && effectiveActive !== null) {
        e.preventDefault();
        choose(effectiveActive);
      }
      return;
    }
    if (e.key === 'Tab') {
      // Register behaviour: Tab accepts what's highlighted, then focus moves on (no preventDefault).
      if (open && dirty && effectiveActive !== null) choose(effectiveActive);
      else close(true);
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (dirty) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    }
  };

  return (
    <div ref={fieldRef} className={cx(styles.field, size === 'medium' && styles.medium, className)}>
      <input
        ref={inputRef}
        className={styles.input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && effectiveActive !== null ? domId(effectiveActive) : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          setDirty(true);
          setActiveId(null);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onClick={() => {
          setOpen((o) => !o);
        }}
      />
      <button
        type="button"
        className={styles.toggle}
        tabIndex={-1}
        aria-label={open ? `Close ${label} list` : `Open ${label} list`}
        disabled={disabled}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
      >
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      <Popover
        open={open}
        onClose={() => {
          close(true);
        }}
        anchor={fieldRef}
        role="presentation"
        matchWidth
        gap={2}
      >
        <div id={listId} role="listbox" aria-label={label} className={styles.list}>
          {matched.map((g) => (
            <div key={g.id} role="group" aria-labelledby={`${baseId}-grp-${g.id}`}>
              <div id={`${baseId}-grp-${g.id}`} role="presentation" className={styles.groupLabel}>
                {g.label}
              </div>
              {g.options.map((o) => (
                <div
                  key={o.id}
                  id={domId(o.id)}
                  role="option"
                  aria-selected={o.id === value}
                  aria-disabled={o.disabled === true ? true : undefined}
                  data-active={o.id === effectiveActive}
                  className={styles.option}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onMouseMove={() => {
                    if (o.disabled !== true && o.id !== effectiveActive) setActiveId(o.id);
                  }}
                  onClick={() => {
                    choose(o.id);
                  }}
                >
                  <span className={styles.optionLabel}>
                    <Highlight option={o} />
                  </span>
                  {renderMeta && <span className={styles.meta}>{renderMeta(o)}</span>}
                </div>
              ))}
            </div>
          ))}
          {matched.length === 0 && !create && <div className={styles.empty}>No matches for “{query.trim()}”</div>}
          {create && (
            <div
              id={domId(CREATE_ID)}
              role="option"
              aria-selected={false}
              data-active={effectiveActive === CREATE_ID}
              className={cx(styles.option, styles.create)}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onMouseMove={() => {
                if (effectiveActive !== CREATE_ID) setActiveId(CREATE_ID);
              }}
              onClick={() => {
                choose(CREATE_ID);
              }}
            >
              <Icon name="add" />
              <span className={styles.optionLabel}>{create.label}</span>
            </div>
          )}
        </div>
        {footerAction && (
          <button
            type="button"
            className={cx(styles.option, styles.create, styles.footerAction)}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={() => {
              close(true);
              footerAction.onSelect();
            }}
          >
            <Icon name={footerAction.icon ?? 'settings'} />
            <span className={styles.optionLabel}>{footerAction.label}</span>
          </button>
        )}
      </Popover>
    </div>
  );
}
