// Reflect's filter bar controls (S6.1), as in YNAB (trial, 2026-10-09): previous / date / next,
// a preset list with Custom (start and end month, Cancel / Apply), and checkbox trees for
// categories and accounts with search, Select All / Select None and Cancel / Done. Nothing
// applies until Apply or Done.
import { useMemo, useRef, useState, type RefObject } from 'react';
import type { Month } from '@hafb/shared';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Checkbox } from '../../ui/Checkbox.tsx';
import { Chip } from '../../ui/Chip.tsx';
import { Combobox } from '../../ui/Combobox.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Popover } from '../../ui/Popover.tsx';
import { TextInput } from '../../ui/TextInput.tsx';
import {
  filterTree,
  leafIds,
  monthLong,
  RANGE_PRESETS,
  rangeLabel,
  selectionLabel,
  type ReflectFilters,
  type TreeNode,
} from './reflectModel.ts';
import styles from './Reflect.module.css';

export interface RangeFilterProps {
  filters: ReflectFilters;
  range: { from: Month; to: Month };
  months: readonly Month[];
  onChange: (f: ReflectFilters) => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

export function RangeFilter({ filters, range, months, onChange, onPrevious, onNext }: RangeFilterProps) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const label = rangeLabel(range.from, range.to);
  return (
    <div className={styles.range} role="group" aria-label="Date range">
      <IconButton icon="chevronLeft" label="Previous" size="small" disabled={onPrevious === null} onClick={() => onPrevious?.()} />
      <Chip
        ref={chip}
        icon="calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range: ${label}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label} <Icon name="chevronDown" />
      </Chip>
      <IconButton icon="chevronRight" label="Next" size="small" disabled={onNext === null} onClick={() => onNext?.()} />
      {open && (
        <RangePopover
          anchor={chip}
          filters={filters}
          range={range}
          months={months}
          onClose={() => {
            setOpen(false);
          }}
          onChange={(f) => {
            onChange(f);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RangePopover({
  anchor,
  filters,
  range,
  months,
  onClose,
  onChange,
}: {
  anchor: RefObject<HTMLElement | null>;
  filters: ReflectFilters;
  range: { from: Month; to: Month };
  months: readonly Month[];
  onClose: () => void;
  onChange: (f: ReflectFilters) => void;
}) {
  const [custom, setCustom] = useState(filters.preset === 'custom');
  const [from, setFrom] = useState<Month>(range.from);
  const [to, setTo] = useState<Month>(range.to);
  const options = useMemo(() => [{ id: 'months', label: 'Months', options: months.map((m) => ({ id: m, label: monthLong(m) })) }], [months]);
  const pick = (which: 'from' | 'to', id: string): void => {
    const m = months.find((x) => x === id);
    if (m === undefined) return;
    if (which === 'from') {
      setFrom(m);
      if (m > to) setTo(m);
    } else {
      setTo(m);
      if (m < from) setFrom(m);
    }
  };
  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-start" role="dialog" label="Date range" className={styles.rangePop}>
      <div role="radiogroup" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={!custom && filters.preset === p.id}
            className={styles.preset}
            onClick={() => {
              onChange({ ...filters, preset: p.id });
            }}
          >
            {p.label}
            {!custom && filters.preset === p.id && <Icon name="checkmark" />}
          </button>
        ))}
        <hr className={styles.rule} />
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={styles.preset}
          onClick={() => {
            setCustom(true);
          }}
        >
          Custom
          {custom && <Icon name="checkmark" />}
        </button>
      </div>
      {custom && (
        <>
          <div className={styles.custom}>
            <label>Start Date</label>
            <Combobox label="Start month" size="compact" groups={options} value={from} onChange={(id) => { pick('from', id); }} />
            <label>End Date</label>
            <Combobox label="End month" size="compact" groups={options} value={to} onChange={(id) => { pick('to', id); }} />
          </div>
          <div className={styles.popActions}>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                onChange({ ...filters, preset: 'custom', from, to });
              }}
            >
              Apply
            </Button>
          </div>
        </>
      )}
    </Popover>
  );
}

export interface TreeFilterProps {
  noun: 'Categories' | 'Accounts';
  icon: 'filter' | 'accounts';
  tree: readonly TreeNode[];
  excluded: readonly string[];
  onChange: (excluded: string[]) => void;
}

/** "All Categories" / "15 Selected Categories" chip with YNAB's checkbox tree. */
export function TreeFilter({ noun, icon, tree, excluded, onChange }: TreeFilterProps) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const all = leafIds(tree);
  const out = new Set(excluded);
  const label = selectionLabel(noun, all.filter((id) => !out.has(id)).length, all.length);
  return (
    <>
      <Chip
        ref={chip}
        icon={icon}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...(label.count === undefined ? {} : { count: label.count })}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label.text} <Icon name="chevronDown" />
      </Chip>
      {open && (
        <TreePopover
          anchor={chip}
          noun={noun}
          tree={tree}
          excluded={excluded}
          onClose={() => {
            setOpen(false);
          }}
          onDone={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function TreePopover({
  anchor,
  noun,
  tree,
  excluded,
  onClose,
  onDone,
}: {
  anchor: RefObject<HTMLElement | null>;
  noun: string;
  tree: readonly TreeNode[];
  excluded: readonly string[];
  onClose: () => void;
  onDone: (excluded: string[]) => void;
}) {
  const [draft, setDraft] = useState<ReadonlySet<string>>(() => new Set(excluded));
  const [query, setQuery] = useState('');
  const shown = filterTree(tree, query);
  const all = leafIds(tree);
  const set = (ids: readonly string[], checked: boolean): void => {
    setDraft((d) => {
      const next = new Set(d);
      for (const id of ids) {
        if (checked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };
  const nothing = all.every((id) => draft.has(id));
  return (
    <Popover open onClose={onClose} anchor={anchor} placement="bottom-start" role="dialog" label={`Filter ${noun.toLowerCase()}`} className={styles.treePop}>
      <div className={styles.treeSearch}>
        <TextInput
          label={`Search All ${noun}`}
          hideLabel
          placeholder={`Search All ${noun}`}
          prefix="search"
          size="compact"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
      </div>
      {shown.length === 0 ? (
        <p className={styles.treeEmpty}>No {noun.toLowerCase()} match “{query}”.</p>
      ) : (
        <ul className={styles.tree} aria-label={noun}>
          {shown.map((node) => {
            if (!node.children) {
              return (
                <li key={node.id}>
                  <Checkbox label={node.name} checked={!draft.has(node.id)} onChange={(v) => { set([node.id], v); }} />
                </li>
              );
            }
            const ids = node.children.map((c) => c.id);
            const on = ids.filter((id) => !draft.has(id)).length;
            return (
              <li key={node.id}>
                <Checkbox
                  className={styles.treeGroup}
                  label={node.name}
                  checked={on === ids.length}
                  indeterminate={on > 0 && on < ids.length}
                  onChange={(v) => {
                    set(ids, v);
                  }}
                />
                <ul>
                  {node.children.map((c) => (
                    <li key={c.id}>
                      {c.hidden === true ? (
                        <span className={styles.treeHidden}>
                          <Checkbox label={c.name} checked={!draft.has(c.id)} onChange={(v) => { set([c.id], v); }} />
                          <Icon name="eyeOff" />
                        </span>
                      ) : (
                        <Checkbox label={c.name} checked={!draft.has(c.id)} onChange={(v) => { set([c.id], v); }} />
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.treeActions}>
        <Button
          size="small"
          variant="toolbar"
          onClick={() => {
            setDraft(new Set());
          }}
        >
          Select All
        </Button>
        <Button
          size="small"
          variant="toolbar"
          onClick={() => {
            setDraft(new Set(all));
          }}
        >
          Select None
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={nothing}
          onClick={() => {
            onDone(all.filter((id) => draft.has(id)));
          }}
        >
          Done
        </Button>
      </div>
    </Popover>
  );
}

