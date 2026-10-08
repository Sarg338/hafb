// Cell editors: thin adapters that put the S3.2 inputs inside a grid cell and report how the edit
// ended (`done`). Each input keeps its own commit rules (money math, date parsing, picker choice);
// the adapter only translates Enter / Tab / Ctrl+Enter / Esc / click-away into grid moves.
//
// Tab is turned into a commit-then-move: the adapter blocks the browser's focus move, asks the
// input to commit exactly as Enter would, and moves only if the commit succeeded (an invalid amount
// or date keeps the editor open with its error).
import { useCallback, useEffect, useRef, useState, type ComponentType, type FocusEvent, type KeyboardEvent } from 'react';
import type { ISODate, Minor, MoneyFormat } from '@hafb/shared';
import { DateInput } from '../DateInput.tsx';
import { MoneyInput } from '../MoneyInput.tsx';
import { TextInput } from '../TextInput.tsx';
import type { EditEnd } from './keys.ts';

interface EditorBase {
  /** Report the end of the edit to the grid. */
  done: (end: EditEnd) => void;
  /** Accessible name of the field, e.g. "Memo". */
  label: string;
}

/** Focus moved somewhere that is not part of this editor (portaled popups count as part of it). */
function leftEditor(e: FocusEvent<HTMLElement>): boolean {
  const next = e.relatedTarget;
  if (next instanceof Node && e.currentTarget.contains(next)) return false;
  if (next instanceof Element && next.closest('#hafb-layer')) return false;
  return true;
}

/** Fire a synthetic Enter at an input so its own commit logic runs. */
function pressEnter(input: HTMLInputElement | null, ctrl = false): void {
  input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: ctrl, bubbles: true, cancelable: true }));
}

/** One `done` per edit: unmounting and blur can otherwise report twice. */
function useOnce(done: (end: EditEnd) => void): (end: EditEnd) => void {
  const fired = useRef(false);
  return useCallback(
    (end: EditEnd) => {
      if (fired.current) return;
      fired.current = true;
      done(end);
    },
    [done],
  );
}

// ---- money --------------------------------------------------------------------------------------

export interface MoneyCellEditorProps extends EditorBase {
  value: Minor;
  format: MoneyFormat;
  onCommit: (value: Minor) => void;
  /** The character that started the edit. */
  seed?: string | undefined;
}

/** The plan grid's Assigned cell and the register's Outflow/Inflow cells (math allowed). */
export function MoneyCellEditor({ value, format, onCommit, seed, label, done }: MoneyCellEditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const finish = useOnce(done);
  const intent = useRef<EditEnd>('enter');
  const synthetic = useRef(false);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    if (seed !== undefined) {
      // MoneyInput selects its text on focus; a typed seed should keep the caret after it.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.setSelectionRange(el.value.length, el.value.length);
        });
      });
    }
  }, [seed]);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (synthetic.current) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      intent.current = e.shiftKey ? 'prev' : 'next';
      synthetic.current = true;
      pressEnter(input.current);
      synthetic.current = false;
      intent.current = 'enter';
    } else if (e.key === 'Enter') {
      intent.current = e.ctrlKey || e.metaKey ? 'saveAndAdd' : 'enter';
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      queueMicrotask(() => {
        finish('cancel');
      });
    }
  };

  return (
    <div
      style={{ width: '100%' }}
      onKeyDownCapture={onKeyDownCapture}
      onBlur={(e) => {
        if (leftEditor(e)) finish('blur');
      }}
    >
      <MoneyInput
        ref={input}
        value={value}
        format={format}
        label={label}
        variant="cell"
        onCommit={onCommit}
        onEnter={() => {
          finish(intent.current);
        }}
        {...(seed === undefined ? {} : { defaultDraft: seed })}
      />
    </div>
  );
}

// ---- date ---------------------------------------------------------------------------------------

export interface DateCellEditorProps extends EditorBase {
  value: ISODate;
  format: string;
  today: ISODate;
  onCommit: (date: ISODate) => void;
}

/** The register's Date cell: typed dates, date keys and the calendar. */
export function DateCellEditor({ value, format, today, onCommit, label, done }: DateCellEditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const finish = useOnce(done);
  const pending = useRef<EditEnd | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      // DateInput blurs itself after a successful Enter commit; the blur then reports `pending`.
      pending.current = e.shiftKey ? 'prev' : 'next';
      pressEnter(input.current);
      pending.current = null;
    } else if (e.key === 'Enter') {
      pending.current = e.ctrlKey || e.metaKey ? 'saveAndAdd' : 'enter';
      queueMicrotask(() => {
        pending.current = null;
      });
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      queueMicrotask(() => {
        finish('cancel');
      });
    }
  };

  return (
    <div
      style={{ width: '100%' }}
      onKeyDownCapture={onKeyDownCapture}
      onBlur={(e) => {
        if (!leftEditor(e) && pending.current === null) return;
        finish(pending.current ?? 'blur');
      }}
    >
      <DateInput ref={input} value={value} format={format} today={today} onCommit={onCommit} label={label} hideLabel size="compact" />
    </div>
  );
}

// ---- text ---------------------------------------------------------------------------------------

export interface TextCellEditorProps extends EditorBase {
  value: string;
  onCommit: (value: string) => void;
  seed?: string | undefined;
  placeholder?: string;
}

/** Plain text (Memo, names): Enter/Tab save, Esc discards. */
export function TextCellEditor({ value, onCommit, seed, placeholder, label, done }: TextCellEditorProps) {
  const [draft, setDraft] = useState(seed ?? value);
  const input = useRef<HTMLInputElement>(null);
  const finish = useOnce(done);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    if (seed === undefined) el.select();
  }, [seed]);

  const save = (end: EditEnd): void => {
    if (draft !== value) onCommit(draft);
    finish(end);
  };

  return (
    <div style={{ width: '100%' }}>
      <TextInput
        ref={input}
        label={label}
        hideLabel
        size="compact"
        value={draft}
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save(e.ctrlKey || e.metaKey ? 'saveAndAdd' : 'enter');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            save(e.shiftKey ? 'prev' : 'next');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish('cancel');
          }
        }}
        onBlur={(e) => {
          if (leftEditor(e)) save('blur');
        }}
      />
    </div>
  );
}

// ---- pickers (payee, category) --------------------------------------------------------------------

/** What a picker slot receives (CategoryPicker / PayeePicker wired to a row's data). */
export interface PickerSlotProps {
  value: string | null;
  autoFocus: true;
  size: 'compact';
  initialQuery?: string;
  onChange: (id: string) => void;
}

export interface PickerCellEditorProps {
  done: (end: EditEnd) => void;
  seed?: string | undefined;
  /** The picker to show (CategoryPicker or PayeePicker), receiving the slot props. */
  Picker: ComponentType<PickerSlotProps>;
  /** The row's current choice. */
  value: string | null;
  onCommit: (id: string) => void;
}

/** A searchable picker in a cell: choosing commits; Enter/Tab then move like any other cell. */
export function PickerCellEditor({ Picker, value, onCommit, seed, done }: PickerCellEditorProps) {
  const finish = useOnce(done);
  const keyed = useRef(false);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>): void => {
    const input = e.target instanceof HTMLInputElement ? e.target : null;
    const listOpen = input?.getAttribute('aria-expanded') === 'true';
    if (e.key === 'Tab') {
      // The picker accepts the highlighted option on Tab; we keep focus in the grid and move.
      e.preventDefault();
      const end: EditEnd = e.shiftKey ? 'prev' : 'next';
      keyed.current = true;
      queueMicrotask(() => {
        finish(end);
      });
    } else if (e.key === 'Enter') {
      const end: EditEnd = e.ctrlKey || e.metaKey ? 'saveAndAdd' : 'enter';
      keyed.current = true;
      queueMicrotask(() => {
        finish(end);
      });
    } else if (e.key === 'Escape' && !listOpen) {
      e.stopPropagation();
      queueMicrotask(() => {
        finish('cancel');
      });
    }
  };

  const onChange = useCallback(
    (id: string): void => {
      onCommit(id);
      // A pointer choice (no key involved) saves and stays on the cell.
      if (!keyed.current) {
        queueMicrotask(() => {
          finish('commit');
        });
      }
    },
    [onCommit, finish],
  );

  return (
    <div
      style={{ width: '100%' }}
      onKeyDownCapture={onKeyDownCapture}
      onBlur={(e) => {
        if (leftEditor(e)) finish('blur');
      }}
    >
      <Picker value={value} autoFocus size="compact" {...(seed === undefined ? {} : { initialQuery: seed })} onChange={onChange} />
    </div>
  );
}
