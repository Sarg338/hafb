import { useEffect, useRef, useState } from 'react';
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { measureRefreshInterval, recordFrames, runScrollBenchmark, type ScrollPlan } from './frameMeter.ts';
import { formatSummary, summarizeFrames } from './frameStats.ts';
import { formatCents, generateRows, type SpikeGridRow } from './syntheticRows.ts';

const ROW_COUNT = 50_000;
const ROW_HEIGHT = 30; // CLAUDE.md §9: register rows ~30 px
const MONEY_COLUMNS = new Set(['outflow', 'inflow']);

const features = tableFeatures({ columnSizingFeature });
const helper = createColumnHelper<typeof features, SpikeGridRow>();
const columns = helper.columns([
  helper.accessor('date', { header: 'Date', size: 96 }),
  helper.accessor('account', { header: 'Account', size: 110 }),
  helper.accessor('payee', { header: 'Payee', size: 170 }),
  helper.accessor('category', { header: 'Category', size: 170 }),
  helper.accessor('memo', { header: 'Memo', size: 220 }),
  helper.accessor('amountCents', {
    id: 'outflow',
    header: 'Outflow',
    size: 110,
    cell: (ctx) => {
      const cents = ctx.getValue();
      return cents < 0 ? formatCents(-cents) : '';
    },
  }),
  helper.accessor('amountCents', {
    id: 'inflow',
    header: 'Inflow',
    size: 110,
    cell: (ctx) => {
      const cents = ctx.getValue();
      return cents > 0 ? formatCents(cents) : '';
    },
  }),
  helper.accessor('cleared', { header: 'C', size: 36 }),
]);

interface GeneratedData {
  rows: SpikeGridRow[];
  generateMs: number;
}

function generateTimed(): GeneratedData {
  const start = performance.now();
  const rows = generateRows(ROW_COUNT);
  return { rows, generateMs: performance.now() - start };
}

function environmentLine(): string {
  return `window ${String(window.innerWidth)}x${String(window.innerHeight)} css px @ ${String(window.devicePixelRatio)}x | rows ${ROW_COUNT.toLocaleString('en-US')} @ ${String(ROW_HEIGHT)} px`;
}

export function GridSpike() {
  const [data] = useState(generateTimed);
  const [mountToPaintMs, setMountToPaintMs] = useState<number | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [copyNote, setCopyNote] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useTable({ features, columns, data: data.rows });
  const tableRows = table.getRowModel().rows;
  const totalWidth = table.getTotalSize();

  // React Compiler is not enabled in this project; this only says the compiler would skip this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    // Rows start below the sticky header, which sits inside the scroll container.
    scrollMargin: ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => {
    const mountedAt = performance.now();
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setMountToPaintMs(performance.now() - mountedAt);
      });
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, []);

  async function run(label: string, measure: (el: HTMLElement) => Promise<number[]>) {
    const el = scrollRef.current;
    if (!el || running) return;
    setRunning(label);
    try {
      const refreshIntervalMs = await measureRefreshInterval();
      const deltas = await measure(el);
      const summary = formatSummary(`[${label}] ${environmentLine()}`, summarizeFrames(deltas, refreshIntervalMs));
      setResults((previous) => [summary, ...previous]);
    } finally {
      setRunning(null);
    }
  }

  const benchmark = (label: string, plan: ScrollPlan) => () => {
    void run(label, (el) => runScrollBenchmark(el, plan));
  };

  const copyResults = () => {
    navigator.clipboard.writeText(results.join('\n\n')).then(
      () => {
        setCopyNote('Copied.');
      },
      () => {
        setCopyNote('Clipboard blocked: select the text below and press Ctrl+C.');
      },
    );
  };

  return (
    <section>
      <h2>(b) Virtualized grid: 50,000 rows</h2>
      <p>
        Generated {ROW_COUNT.toLocaleString('en-US')} rows in {data.generateMs.toFixed(0)} ms · first paint of grid{' '}
        {mountToPaintMs === null ? '…' : `${mountToPaintMs.toFixed(0)} ms`} after mount. Leave the window still while a
        benchmark runs.
      </p>
      <div className="controls">
        <button
          type="button"
          disabled={running !== null}
          onClick={benchmark('steady 3000 px/s, 10 s', { kind: 'steady', pxPerSecond: 3000, durationMs: 10_000 })}
        >
          Steady scroll (10 s)
        </button>
        <button
          type="button"
          disabled={running !== null}
          onClick={benchmark('fling top→bottom, 5 s', { kind: 'fling', durationMs: 5_000 })}
        >
          Fling all 50k rows (5 s)
        </button>
        <button
          type="button"
          disabled={running !== null}
          onClick={() => {
            void run('manual wheel/scrollbar, 10 s', () => recordFrames(10_000));
          }}
        >
          Record manual scrolling (10 s)
        </button>
        <button type="button" disabled={results.length === 0} onClick={copyResults}>
          Copy results
        </button>
        <span>{running ? `Running: ${running}…` : copyNote}</span>
      </div>
      {results.length > 0 && <pre>{results.join('\n\n')}</pre>}

      <div
        ref={scrollRef}
        className="grid-scroll"
        role="grid"
        aria-label="Synthetic register rows"
        aria-rowcount={tableRows.length + 1}
      >
        <div className="grid-header" role="row" aria-rowindex={1} style={{ width: totalWidth }}>
          {table.getHeaderGroups()[0]?.headers.map((header) => (
            <div
              key={header.id}
              role="columnheader"
              className={MONEY_COLUMNS.has(header.column.id) ? 'grid-cell money' : 'grid-cell'}
              style={{ width: header.getSize() }}
            >
              <table.FlexRender header={header} />
            </div>
          ))}
        </div>
        <div className="grid-body" style={{ height: virtualizer.getTotalSize(), width: totalWidth }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = tableRows[item.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={item.index + 2}
                className={item.index % 2 === 1 ? 'grid-row alt' : 'grid-row'}
                style={{ width: totalWidth, transform: `translateY(${String(item.start - ROW_HEIGHT)}px)` }}
              >
                {row.getAllCells().map((cell) => (
                  <div
                    key={cell.id}
                    role="gridcell"
                    className={MONEY_COLUMNS.has(cell.column.id) ? 'grid-cell money' : 'grid-cell'}
                    style={{ width: cell.column.getSize() }}
                  >
                    <table.FlexRender cell={cell} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
