// 50,000-row scroll benchmark on the production DataGrid (S3.4 exit: still 0 missed frames).
// Programmatic scroll is the worst case: every frame re-renders the visible rows on the main thread.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { DataGrid, type GridColumn } from '../../ui/grid/DataGrid.tsx';
import type { GridRow } from '../../ui/grid/types.ts';
import { measureRefreshInterval, recordFrames, runScrollBenchmark, type ScrollPlan } from './frameMeter.ts';
import { formatSummary, summarizeFrames, type FrameSummary } from './frameStats.ts';
import { formatCents, generateRows, type SpikeGridRow } from './syntheticRows.ts';
import styles from './GridBenchmark.module.css';

export const BENCH_ROWS = 50_000;

const COLUMNS: GridColumn<SpikeGridRow>[] = [
  { id: 'date', header: 'Date', width: 98, render: (r) => r.data.date },
  { id: 'account', header: 'Account', width: 120, render: (r) => r.data.account },
  { id: 'payee', header: 'Payee', width: 170, render: (r) => r.data.payee },
  { id: 'category', header: 'Category', width: 170, render: (r) => r.data.category },
  { id: 'memo', header: 'Memo', width: 200, flex: true, render: (r) => r.data.memo },
  { id: 'outflow', header: 'Outflow', width: 110, align: 'end', render: (r) => (r.data.amountCents < 0 ? formatCents(-r.data.amountCents) : '') },
  { id: 'inflow', header: 'Inflow', width: 110, align: 'end', render: (r) => (r.data.amountCents > 0 ? formatCents(r.data.amountCents) : '') },
  { id: 'cleared', header: 'C', width: 44, align: 'center', resizable: false, render: (r) => r.data.cleared },
];

export interface BenchResult {
  label: string;
  summary: FrameSummary;
  text: string;
}

const PLANS: { label: string; plan: ScrollPlan }[] = [
  { label: 'steady 3000 px/s, 10 s', plan: { kind: 'steady', pxPerSecond: 3000, durationMs: 10_000 } },
  { label: 'fling all 50k rows, 5 s', plan: { kind: 'fling', durationMs: 5_000 } },
];

function environment(): string {
  return `window ${String(window.innerWidth)}x${String(window.innerHeight)} css px @ ${String(window.devicePixelRatio)}x | ${BENCH_ROWS.toLocaleString('en-US')} rows`;
}

/** The benchmark page. `autoRun` runs both scroll plans once after the first paint. */
export function GridBenchmark({ autoRun = false }: { autoRun?: boolean }) {
  const [generated] = useState(() => {
    const start = performance.now();
    const data = generateRows(BENCH_ROWS);
    const rows: GridRow<SpikeGridRow>[] = data.map((d) => ({ kind: 'item', id: d.id, data: d }));
    return { rows, ms: performance.now() - start };
  });
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<BenchResult[]>([]);
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  const run = async (label: string, measure: (el: HTMLElement) => Promise<number[]>): Promise<void> => {
    const el = scrollRef.current;
    if (!el) return;
    setRunning(label);
    try {
      const refresh = await measureRefreshInterval();
      const deltas = await measure(el);
      const summary = summarizeFrames(deltas, refresh);
      setResults((prev) => [...prev, { label, summary, text: formatSummary(`[${label}] ${environment()}`, summary) }]);
    } finally {
      setRunning(null);
    }
  };

  const runAll = async (): Promise<void> => {
    setState('running');
    setResults([]);
    for (const p of PLANS) await run(p.label, (el) => runScrollBenchmark(el, p.plan));
    setState('done');
  };

  useEffect(() => {
    if (!autoRun || started.current) return;
    // Let the grid paint before measuring. The flag is set when the timer fires, so StrictMode's
    // mount-cleanup-mount doesn't cancel the run.
    const id = window.setTimeout(() => {
      started.current = true;
      void runAll();
    }, 600);
    return () => {
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  const json = useMemo(() => JSON.stringify(results.map((r) => ({ label: r.label, ...r.summary }))), [results]);

  return (
    <div className={styles.bench}>
      <div className={styles.controls}>
        <Button variant="primary" disabled={running !== null} onClick={() => void runAll()}>
          Run scroll benchmark
        </Button>
        <Button
          disabled={running !== null}
          onClick={() => {
            void run('manual scrolling, 10 s', () => recordFrames(10_000));
          }}
        >
          Record manual scrolling (10 s)
        </Button>
        <span className={styles.note}>
          {running ? `Running: ${running}…` : `Generated ${BENCH_ROWS.toLocaleString('en-US')} rows in ${generated.ms.toFixed(0)} ms. Keep the window still while it runs.`}
        </span>
      </div>
      <pre id="bench-result" className={styles.result} data-state={state} data-result={json} aria-live="polite">
        {results.length === 0 ? (state === 'running' ? 'Running…' : 'No results yet.') : results.map((r) => r.text).join('\n\n')}
      </pre>
      <div className={styles.frame}>
        <DataGrid<SpikeGridRow> label="Synthetic register rows" rows={generated.rows} columns={COLUMNS} density="register" selectable scrollRef={scrollRef} />
      </div>
    </div>
  );
}

/** Kept for the Phase 0 spike page until S3.3 retires it. */
export function GridSpike() {
  return <GridBenchmark />;
}
