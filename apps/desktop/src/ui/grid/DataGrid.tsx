// The editable, virtualized grid behind the Plan and Register screens (S3.4).
//
// - Column model and sizes: TanStack Table (column sizing feature) over our GridColumn list.
// - Rows: TanStack Virtual, fixed heights from the density tokens (group rows taller).
// - Keyboard, selection, groups and sizing logic: the pure models in this folder.
// - ARIA: role grid (treegrid when there are groups), aria-rowcount/rowindex/colindex for
//   virtualization, aria-selected rows, one tabbable cell (roving tabindex).
// - Events are delegated to the grid element; rows are memoized and get no per-row closures.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react';
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Checkbox } from '../Checkbox.tsx';
import { cx } from '../cx.ts';
import { tabbables } from '../focus.ts';
import { Icon } from '../Icon.tsx';
import styles from './DataGrid.module.css';
import { endEdit, gridIntent, type EditEnd } from './keys.ts';
import { moveActive, type NavContext } from './navigation.ts';
import { flattenRows, type VisibleRow } from './rows.ts';
import { applyClick, EMPTY_SELECTION, extend, headerState, selectAll, selectOnly, toggle, toggleAll, type SelectionState } from './selection.ts';
import { keyboardResize, resetWidth, resize, widthOf, type ColumnWidths } from './sizing.ts';
import { sameCell, type CellRef, type GridRow } from './types.ts';

export interface EditorArgs<T> {
  row: GridRow<T>;
  /** The character that started the edit, if the user started by typing. */
  seed: string | undefined;
  /** Report how the edit ended; the grid moves the active cell accordingly. */
  done: (end: EditEnd) => void;
}

export interface GridColumn<T> {
  id: string;
  header: string;
  /** Default width (px). A `flex` column grows to fill spare width, never below this. */
  width: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: boolean;
  align?: 'start' | 'end' | 'center';
  /** Hide the header text visually (icon columns); it is still the accessible name. */
  headerHidden?: boolean;
  resizable?: boolean;
  /** Display content. Plain strings get ellipsis truncation. */
  render: (row: GridRow<T>) => ReactNode;
  /** Whether this cell opens an editor (default: no editor = read-only). */
  editable?: (row: GridRow<T>) => boolean;
  editor?: (args: EditorArgs<T>) => ReactNode;
  /** Sort indicator; clicking the header calls onSort. */
  sort?: 'ascending' | 'descending' | 'none';
}

export interface DataGridProps<T> {
  /** Accessible name of the grid. */
  label: string;
  rows: readonly GridRow<T>[];
  columns: readonly GridColumn<T>[];
  density: 'plan' | 'register';
  /** Leading checkbox column for row selection. */
  selectable?: boolean;
  defaultSelected?: Iterable<string>;
  /** Controlled selection: when this changes, the grid's selection follows it. */
  selected?: ReadonlySet<string>;
  onSelectionChange?: (selected: ReadonlySet<string>) => void;
  defaultCollapsed?: Iterable<string>;
  /** Controlled collapsed groups (collapse all / expand all from outside the grid). */
  collapsed?: ReadonlySet<string>;
  onCollapsedChange?: (collapsed: ReadonlySet<string>) => void;
  /** Columns where a single click starts editing (the Plan's Assigned column, as in YNAB). */
  editOnClick?: readonly string[];
  /** Column width overrides (persist them with onColumnWidthsChange). */
  columnWidths?: ColumnWidths;
  onColumnWidthsChange?: (widths: Record<string, number>) => void;
  /** After Enter commits an edit: move down (register) or stay. */
  enterMoves?: 'down' | 'none';
  /** Ctrl+Enter: the row was saved; start another (register "save and add another"). */
  onSaveAndAddAnother?: (rowId: string) => void;
  onSort?: (columnId: string) => void;
  /** Right-click, Shift+F10 or the Menu key on a row; coordinates are viewport pixels. */
  onRowContextMenu?: (rowId: string, point: { x: number; y: number }) => void;
  /** Shown when there are no rows. */
  empty?: ReactNode;
  /** Open with this cell active (and optionally editing): deep links. */
  initialActive?: CellRef;
  initialEditing?: boolean;
  /** Move to (and optionally edit) a cell after mount, e.g. the new row after Ctrl+Enter. Change `key` to repeat. */
  request?: { cell: CellRef; edit: boolean; key: number };
  /**
   * One row shown taller with extra content underneath it, spanning all columns (the register's
   * Cancel / Save strip under the transaction being edited).
   */
  expandedRow?: { id: string; height: number; content: ReactNode };
  /** The scroll element (benchmarks drive scrollTop). */
  scrollRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
}

const CHECK_COLUMN = '__select__';
const CHECK_WIDTH = 40;
const OVERSCAN = 12;
const features = tableFeatures({ columnSizingFeature });
/** TanStack only models the columns (sizes); rows come from the virtualizer, so data is empty. */
type NoData = Record<string, never>;
const helper = createColumnHelper<typeof features, NoData>();
const EMPTY_DATA: NoData[] = [];

function readPx(el: HTMLElement | null, name: string, fallback: number): number {
  if (!el) return fallback;
  const n = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const cellSelector = (cell: CellRef): string => `[data-row="${CSS.escape(cell.rowId)}"][data-col="${CSS.escape(cell.columnId)}"]`;

interface ColumnMeta {
  id: string;
  align: 'start' | 'end' | 'center';
}

interface RowProps {
  /** Row shape for ARIA (data is rendered through `renderCell`). */
  vrow: VisibleRow<unknown>;
  columns: readonly ColumnMeta[];
  selectable: boolean;
  selected: boolean;
  /** Column id of the active cell in this row, else null. */
  activeColumn: string | null;
  editingColumn: string | null;
  /** Renders a data cell's content (display or editor); stable across scrolling and selection. */
  renderCell: (rowId: string, columnIndex: number, editing: boolean) => ReactNode;
  isEditable: (rowId: string, columnId: string) => boolean;
  top: number;
  ariaRowIndex: number;
  /** Content under the row's cells (expandedRow), and its height. */
  extra?: ReactNode;
  extraHeight?: number;
}

const Row = memo(function Row({ vrow, columns, selectable, selected, activeColumn, editingColumn, renderCell, isEditable, top, ariaRowIndex, extra, extraHeight }: RowProps) {
  const { row } = vrow;
  const isGroup = row.kind === 'group';
  const offset = selectable ? 1 : 0;
  return (
    <div
      role="row"
      className={cx(styles.row, isGroup ? styles.group : styles.item, extra !== undefined && styles.expanded)}
      style={
        extra !== undefined && extraHeight !== undefined
          ? { transform: `translateY(${String(top)}px)`, height: `calc(var(--grid-row-height) + ${String(extraHeight)}px)`, gridTemplateRows: `var(--grid-row-height) ${String(extraHeight)}px` }
          : { transform: `translateY(${String(top)}px)` }
      }
      aria-rowindex={ariaRowIndex}
      aria-selected={isGroup ? undefined : selected}
      aria-level={vrow.expanded !== undefined || vrow.level === 2 ? vrow.level : undefined}
      aria-expanded={vrow.expanded}
      aria-posinset={vrow.posInSet}
      aria-setsize={vrow.setSize}
      data-row-id={row.id}
    >
      {selectable && (
        <div
          role="gridcell"
          className={cx(styles.cell, styles.checkCell, activeColumn === CHECK_COLUMN && styles.active)}
          aria-colindex={1}
          tabIndex={activeColumn === CHECK_COLUMN ? 0 : -1}
          data-cell=""
          data-row={row.id}
          data-col={CHECK_COLUMN}
        >
          {!isGroup && <Checkbox checked={selected} onChange={() => undefined} aria-label="Select row" tabIndex={-1} data-select="" />}
        </div>
      )}
      {columns.map((col, ci) => {
        const editing = editingColumn === col.id;
        const active = activeColumn === col.id;
        const content = renderCell(row.id, ci, editing);
        return (
          <div
            key={col.id}
            role="gridcell"
            className={cx(styles.cell, col.align === 'end' && styles.end, col.align === 'center' && styles.center, active && styles.active, editing && styles.editing)}
            aria-colindex={ci + 1 + offset}
            aria-readonly={isEditable(row.id, col.id) ? undefined : true}
            tabIndex={active && !editing ? 0 : -1}
            data-cell=""
            data-row={row.id}
            data-col={col.id}
          >
            {ci === 0 && isGroup ? (
              <span className={styles.groupName}>
                <button type="button" className={styles.toggle} tabIndex={-1} aria-hidden="true" data-toggle="">
                  <Icon name={vrow.expanded === false ? 'chevronRight' : 'chevronDown'} />
                </button>
                {typeof content === 'string' ? <span className={styles.cellText}>{content}</span> : content}
              </span>
            ) : typeof content === 'string' ? (
              <span className={styles.cellText}>{content}</span>
            ) : (
              content
            )}
          </div>
        );
      })}
      {extra !== undefined && <div className={styles.rowExtra}>{extra}</div>}
    </div>
  );
});

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    label,
    rows,
    columns,
    density,
    selectable = false,
    enterMoves = 'down',
    onSaveAndAddAnother,
    onSort,
    onRowContextMenu,
    empty,
    initialActive,
    initialEditing = false,
    className,
    style,
  } = props;

  // ---- state -----------------------------------------------------------------------------------
  const [selection, setSelection] = useState<SelectionState>(() => ({ selected: new Set(props.defaultSelected ?? []), anchor: null }));
  const [ownCollapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(props.defaultCollapsed ?? []));
  const collapsed = props.collapsed ?? ownCollapsed;
  // Controlled selection: adopt a new outside value (the anchor resets).
  const selectedProp = props.selected;
  const [adopted, setAdopted] = useState(selectedProp);
  if (selectedProp !== adopted) {
    setAdopted(selectedProp);
    if (selectedProp !== undefined && selectedProp !== selection.selected) setSelection({ selected: selectedProp, anchor: null });
  }
  const [ownWidths, setOwnWidths] = useState<ColumnWidths>({});
  const widths = props.columnWidths ?? ownWidths;
  const [active, setActive] = useState<CellRef | null>(initialActive ?? null);
  const [editing, setEditing] = useState<{ cell: CellRef; seed: string | undefined } | null>(
    initialActive && initialEditing ? { cell: initialActive, seed: undefined } : null,
  );
  const [focusTick, setFocusTick] = useState(0);
  const [resizing, setResizing] = useState<string | null>(null);

  const scrollEl = useRef<HTMLDivElement | null>(null);
  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      scrollEl.current = el;
      const ref = props.scrollRef;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [props.scrollRef],
  );

  // ---- rows, columns, sizes --------------------------------------------------------------------
  const visible = useMemo(() => flattenRows(rows, collapsed), [rows, collapsed]);
  const hasGroups = useMemo(() => rows.some((r) => r.kind === 'group'), [rows]);
  const itemOrder = useMemo(() => visible.filter((v) => v.row.kind === 'item').map((v) => v.row.id), [visible]);
  const rowById = useMemo(() => new Map(visible.map((v) => [v.row.id, v])), [visible]);
  const columnIds = useMemo(() => [...(selectable ? [CHECK_COLUMN] : []), ...columns.map((c) => c.id)], [columns, selectable]);
  const columnById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const columnDefs = useMemo(
    () =>
      columns.map((c) =>
        helper.display({
          id: c.id,
          header: c.header,
          size: c.width,
          ...(c.minWidth === undefined ? {} : { minSize: c.minWidth }),
          ...(c.maxWidth === undefined ? {} : { maxSize: c.maxWidth }),
        }),
      ),
    [columns],
  );
  const columnSizing = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, widthOf(c, widths)])), [columns, widths]);
  const table = useTable({ features, columns: columnDefs, data: EMPTY_DATA, state: { columnSizing } });
  const leafColumns = table.getAllLeafColumns();
  const template = [
    ...(selectable ? [`${String(CHECK_WIDTH)}px`] : []),
    ...leafColumns.map((lc) => {
      const size = lc.getSize();
      return columnById.get(lc.id)?.flex === true ? `minmax(${String(size)}px, 1fr)` : `${String(size)}px`;
    }),
  ].join(' ');
  const minWidth = table.getTotalSize() + (selectable ? CHECK_WIDTH : 0);

  const setWidths = useCallback(
    (next: Record<string, number>) => {
      if (props.onColumnWidthsChange) props.onColumnWidthsChange(next);
      else setOwnWidths(next);
    },
    [props],
  );

  // ---- virtualizer -----------------------------------------------------------------------------
  const [metrics, setMetrics] = useState({ row: density === 'plan' ? 34 : 30, group: 36, header: 32 });
  useLayoutEffect(() => {
    const el = scrollEl.current;
    setMetrics({
      row: readPx(el, density === 'plan' ? '--d-row-plan' : '--d-row-register', density === 'plan' ? 34 : 30),
      group: readPx(el, '--d-row-group', 36),
      header: readPx(el, '--d-row-header', 32),
    });
  }, [density]);

  // Stable callbacks: TanStack Virtual memoizes its measurements on getItemKey's identity, and a
  // fresh closure per render would re-measure every row on every scroll frame.
  const expandedId = props.expandedRow?.id;
  const expandedHeight = props.expandedRow?.height ?? 0;
  const estimateSize = useCallback(
    (i: number) => {
      const r = visible[i]?.row;
      if (r?.kind === 'group') return metrics.group;
      return r !== undefined && r.id === expandedId ? metrics.row + expandedHeight : metrics.row;
    },
    [visible, metrics, expandedId, expandedHeight],
  );
  const getItemKey = useCallback((i: number) => visible[i]?.row.id ?? i, [visible]);
  const getScrollElement = useCallback(() => scrollEl.current, []);
  // React Compiler is not enabled in this project; the rule only notes the compiler would skip this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    scrollMargin: metrics.header,
    overscan: OVERSCAN,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [metrics, virtualizer, expandedId, expandedHeight]);

  const nav = useCallback(
    (): NavContext => ({
      rowIds: visible.map((v) => v.row.id),
      columnIds,
      pageSize: Math.max(1, Math.floor(((scrollEl.current?.clientHeight ?? 400) - metrics.header) / metrics.row) - 1),
    }),
    [visible, columnIds, metrics],
  );

  const isEditable = useCallback(
    (rowId: string, columnId: string): boolean => {
      const col = columnById.get(columnId);
      const vrow = rowById.get(rowId);
      return !!col && !!vrow && col.editor !== undefined && col.editable?.(vrow.row) === true;
    },
    [columnById, rowById],
  );

  // ---- selection / collapse helpers --------------------------------------------------------------
  const commitSelection = useCallback(
    (next: SelectionState) => {
      setSelection(next);
      props.onSelectionChange?.(next.selected);
    },
    [props],
  );
  const setCollapsedAndNotify = useCallback(
    (next: ReadonlySet<string>) => {
      setCollapsed(next);
      props.onCollapsedChange?.(next);
    },
    [props],
  );
  const toggleGroup = useCallback(
    (groupId: string, expand?: boolean) => {
      const next = new Set(collapsed);
      const isCollapsed = next.has(groupId);
      const shouldExpand = expand ?? isCollapsed;
      if (shouldExpand) next.delete(groupId);
      else next.add(groupId);
      setCollapsedAndNotify(next);
    },
    [collapsed, setCollapsedAndNotify],
  );

  // ---- focus -------------------------------------------------------------------------------------
  const focusActive = useCallback(() => {
    setFocusTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (focusTick === 0 || !active) return;
    const index = visible.findIndex((v) => v.row.id === active.rowId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    // The row may only render after the scroll; focus on the next frame.
    const id = requestAnimationFrame(() => {
      const el = scrollEl.current?.querySelector<HTMLElement>(cellSelector(active));
      el?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(id);
    };
    // Only on explicit focus requests; scrolling or row changes must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  // The active row went away (its group collapsed, a filter hid it, it was deleted): move to its
  // group row, or the nearest row, and keep keyboard focus in the grid if it was there.
  useEffect(() => {
    if (!active || rowById.has(active.rowId)) return;
    const hadFocus = document.activeElement === document.body || (scrollEl.current?.contains(document.activeElement) ?? false);
    const source = rows.find((r) => r.id === active.rowId);
    const group = source?.groupId !== undefined ? rowById.get(source.groupId) : undefined;
    const fallback = group?.row.id ?? visible[0]?.row.id;
    if (fallback === undefined) {
      setActive(null);
      return;
    }
    const column = columnIds.includes(active.columnId) && group === undefined ? active.columnId : (columns[0]?.id ?? active.columnId);
    setActive({ rowId: fallback, columnId: column });
    setEditing(null);
    if (hadFocus) focusActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowById]);

  // Programmatic moves (a new row to fill in after "save and add another").
  const requestKey = props.request?.key;
  useEffect(() => {
    const req = props.request;
    if (!req) return;
    setActive(req.cell);
    setEditing(req.edit ? { cell: req.cell, seed: undefined } : null);
    if (!req.edit) focusActive();
    else {
      const index = visible.findIndex((v) => v.row.id === req.cell.rowId);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Deep links: open with the active cell scrolled into view.
  useEffect(() => {
    if (initialActive) focusActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leaveGrid = useCallback((dir: 1 | -1) => {
    const grid = scrollEl.current;
    if (!grid) return;
    const all = tabbables(document.body).filter((el) => !grid.contains(el));
    const target = dir === 1 ? all.find((el) => grid.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : all.findLast((el) => grid.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    target?.focus();
  }, []);

  // ---- editing -----------------------------------------------------------------------------------
  const editingRef = useRef(editing);
  useLayoutEffect(() => {
    editingRef.current = editing;
  });
  const onEditEnd = useCallback(
    (end: EditEnd) => {
      const current = editingRef.current;
      if (!current) return;
      const outcome = endEdit(nav(), current.cell, end, { enterMoves, isEditable });
      setActive(outcome.active);
      setEditing(outcome.editing ? { cell: outcome.editing, seed: undefined } : null);
      if (outcome.saveAndAdd) onSaveAndAddAnother?.(current.cell.rowId);
      if (outcome.leaveGrid) leaveGrid(end === 'prev' ? -1 : 1);
      else if (end !== 'blur' && !outcome.editing) focusActive();
    },
    [nav, enterMoves, isEditable, onSaveAndAddAnother, leaveGrid, focusActive],
  );

  const columnMeta = useMemo(() => columns.map((c): ColumnMeta => ({ id: c.id, align: c.align ?? 'start' })), [columns]);
  const editSeed = editing?.seed;
  const renderCell = useCallback(
    (rowId: string, columnIndex: number, isEditing: boolean): ReactNode => {
      const vrow = rowById.get(rowId);
      const col = columns[columnIndex];
      if (!vrow || !col) return null;
      if (isEditing && col.editor) return col.editor({ row: vrow.row, seed: editSeed, done: onEditEnd });
      return col.render(vrow.row);
    },
    [rowById, columns, editSeed, onEditEnd],
  );

  // ---- events (delegated) ------------------------------------------------------------------------
  const cellFrom = (target: EventTarget | null): { cell: CellRef; el: HTMLElement } | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>('[data-cell]');
    const rowId = el?.dataset.row;
    const columnId = el?.dataset.col;
    if (!el || rowId === undefined || columnId === undefined) return null;
    return { cell: { rowId, columnId }, el };
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const hit = cellFrom(e.target);
    if (!hit) return;
    const { cell } = hit;
    // Controls inside a cell (a row being edited, a cleared or flag button) handle their own clicks.
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [role=combobox], [data-interactive]')) return;
    // Clicks inside the open editor belong to the editor.
    if (editing && sameCell(editing.cell, cell)) return;
    if (editing) onEditEnd('blur');
    const vrow = rowById.get(cell.rowId);
    if (!vrow) return;
    if (e.target instanceof Element && e.target.closest('[data-toggle]')) {
      e.preventDefault();
      toggleGroup(cell.rowId);
    } else if (vrow.row.kind === 'item') {
      if (e.target instanceof Element && e.target.closest('[data-select]')) {
        e.preventDefault();
        commitSelection(toggle(selection, cell.rowId));
      } else {
        commitSelection(applyClick(selection, itemOrder, cell.rowId, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }));
      }
    }
    setActive(cell);
    if (props.editOnClick?.includes(cell.columnId) === true && !e.shiftKey && !e.ctrlKey && !e.metaKey && isEditable(cell.rowId, cell.columnId)) {
      e.preventDefault();
      setEditing({ cell, seed: undefined });
      return;
    }
    // Keep focus on the cell element, not on inner controls (checkbox, chevron).
    if (e.shiftKey) e.preventDefault();
    focusActive();
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    const hit = cellFrom(e.target);
    if (!hit || !isEditable(hit.cell.rowId, hit.cell.columnId)) return;
    setActive(hit.cell);
    setEditing({ cell: hit.cell, seed: undefined });
  };

  const onContextMenu = (e: MouseEvent<HTMLDivElement>): void => {
    if (!onRowContextMenu) return;
    const hit = cellFrom(e.target);
    if (!hit || editing) return;
    e.preventDefault();
    const vrow = rowById.get(hit.cell.rowId);
    if (vrow?.row.kind === 'item' && !selection.selected.has(hit.cell.rowId)) commitSelection(selectOnly(selection, hit.cell.rowId));
    setActive(hit.cell);
    onRowContextMenu(hit.cell.rowId, { x: e.clientX, y: e.clientY });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (editing) return; // The editor owns the keyboard; it reports back through `done`.
    if (!(e.target instanceof HTMLElement) || !e.target.matches('[data-cell]')) return;
    const current = active ?? moveActive(nav(), null, 'ArrowDown', false);
    if (!current) return;
    const vrow = rowById.get(current.rowId);
    const intent = gridIntent(e, {
      isGroupRow: vrow?.row.kind === 'group',
      editable: isEditable(current.rowId, current.columnId),
      atFirstColumn: columnIds.indexOf(current.columnId) <= (selectable ? 1 : 0),
      expanded: vrow?.expanded,
    });
    if (intent.type === 'none') return;
    e.preventDefault();
    switch (intent.type) {
      case 'move': {
        const next = moveActive(nav(), active, intent.key, intent.ctrl);
        if (next) setActive(next);
        focusActive();
        break;
      }
      case 'extend': {
        const next = moveActive(nav(), current, intent.key, false);
        if (!next) break;
        setActive(next);
        if (rowById.get(next.rowId)?.row.kind === 'item') {
          const anchored = selection.anchor === null && vrow?.row.kind === 'item' ? selectOnly(selection, current.rowId) : selection;
          commitSelection(extend(anchored, itemOrder, next.rowId));
        }
        focusActive();
        break;
      }
      case 'edit':
        setEditing({ cell: current, seed: intent.seed });
        break;
      case 'toggleSelect':
        commitSelection(toggle(selection, current.rowId));
        break;
      case 'selectAll':
        commitSelection(selectAll(itemOrder));
        break;
      case 'toggleGroup':
        toggleGroup(current.rowId);
        break;
      case 'collapse':
        toggleGroup(current.rowId, false);
        break;
      case 'expand':
        toggleGroup(current.rowId, true);
        break;
      case 'addRow':
        onSaveAndAddAnother?.(current.rowId);
        break;
      case 'contextMenu': {
        const rect = e.target.getBoundingClientRect();
        onRowContextMenu?.(current.rowId, { x: rect.left + 8, y: rect.bottom });
        break;
      }
    }
  };

  // ---- column resize -----------------------------------------------------------------------------
  const startResize = (col: GridColumn<T>, e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(col, widths);
    const base = { ...widths };
    setResizing(col.id);
    const onMove = (ev: PointerEvent): void => {
      setWidths(resize(base, col, startWidth, ev.clientX - startX));
    };
    const onUp = (): void => {
      setResizing(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ---- render ------------------------------------------------------------------------------------
  const headerCheck = headerState(selection.selected, itemOrder);
  const items = virtualizer.getVirtualItems();
  const gridStyle: CSSProperties & { '--grid-template': string } = { ...style, '--grid-template': template };

  return (
    <div
      ref={setScrollEl}
      role={hasGroups ? 'treegrid' : 'grid'}
      aria-label={label}
      aria-rowcount={visible.length + 1}
      aria-colcount={columnIds.length}
      aria-multiselectable={selectable || undefined}
      className={cx(styles.grid, styles[density], className)}
      style={gridStyle}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      // The grid itself is reachable by Tab only when no cell is active yet.
      tabIndex={active === null ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget && active === null) {
          const first = moveActive(nav(), null, 'ArrowDown', false);
          if (first) {
            setActive(first);
            focusActive();
          }
        }
      }}
    >
      <div className={styles.inner} style={{ minWidth }}>
        <div role="rowgroup" className={styles.head}>
          <div role="row" className={styles.headerRow} aria-rowindex={1}>
            {selectable && (
              <div role="columnheader" className={cx(styles.columnHeader, styles.checkCell)} aria-colindex={1}>
                <Checkbox
                  checked={headerCheck === 'all'}
                  indeterminate={headerCheck === 'some'}
                  onChange={() => {
                    commitSelection(toggleAll(selection, itemOrder));
                  }}
                  aria-label="Select all rows"
                />
              </div>
            )}
            {columns.map((col, ci) => (
              <div
                key={col.id}
                role="columnheader"
                className={cx(styles.columnHeader, col.align === 'end' && styles.end, col.align === 'center' && styles.center)}
                aria-colindex={ci + 1 + (selectable ? 1 : 0)}
                aria-sort={col.sort}
                aria-label={col.headerHidden === true ? col.header : undefined}
              >
                {col.sort !== undefined && onSort ? (
                  <button type="button" className={styles.sortButton} onClick={() => {
                    onSort(col.id);
                  }}>
                    <span className={styles.headerLabel}>{col.headerHidden === true ? null : col.header}</span>
                    {col.sort !== 'none' && <Icon name={col.sort === 'ascending' ? 'chevronUp' : 'chevronDown'} />}
                  </button>
                ) : (
                  <span className={styles.headerLabel}>{col.headerHidden === true ? null : col.header}</span>
                )}
                {col.resizable !== false && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${col.header}`}
                    aria-valuenow={widthOf(col, widths)}
                    aria-valuemin={col.minWidth ?? 40}
                    aria-valuemax={col.maxWidth ?? 800}
                    tabIndex={0}
                    className={styles.resizer}
                    data-active={resizing === col.id}
                    onPointerDown={(e) => {
                      startResize(col, e);
                    }}
                    onDoubleClick={() => {
                      setWidths(resetWidth(widths, col.id));
                    }}
                    onKeyDown={(e) => {
                      const next = keyboardResize(widths, col, e.key, e.shiftKey);
                      if (next) {
                        e.preventDefault();
                        e.stopPropagation();
                        setWidths(next);
                      }
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup" className={styles.body} style={{ height: virtualizer.getTotalSize() }}>
          {items.map((vi) => {
            const vrow = visible[vi.index];
            if (!vrow) return null;
            const rowActive = active?.rowId === vrow.row.id ? active.columnId : null;
            const rowEditing = editing?.cell.rowId === vrow.row.id ? editing.cell.columnId : null;
            return (
              <Row
                key={vrow.row.id}
                vrow={vrow}
                columns={columnMeta}
                selectable={selectable}
                selected={selection.selected.has(vrow.row.id)}
                activeColumn={rowActive}
                editingColumn={rowEditing}
                renderCell={renderCell}
                isEditable={isEditable}
                top={vi.start - virtualizer.options.scrollMargin}
                ariaRowIndex={vi.index + 2}
                {...(props.expandedRow && props.expandedRow.id === vrow.row.id ? { extra: props.expandedRow.content, extraHeight: props.expandedRow.height } : {})}
              />
            );
          })}
        </div>
        {visible.length === 0 && empty !== undefined && <div className={styles.empty}>{empty}</div>}
      </div>
    </div>
  );
}

export { EMPTY_SELECTION };
