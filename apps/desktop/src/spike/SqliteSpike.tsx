import { useState } from 'react';
import { spikeIpc } from './ipc.ts';

const ROWS = 50_000;

export function SqliteSpike() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const append = (line: string) => {
    setLog((previous) => [...previous, line]);
  };

  async function runAll() {
    setBusy(true);
    setLog([]);
    try {
      let t = performance.now();
      const open = await spikeIpc.sqliteOpen();
      append(
        `open: ${open.path}\n  SQLite ${open.sqliteVersion}, journal_mode=${open.journalMode}, existing rows=${String(open.rowCount)}, rust ${open.rustMs.toFixed(1)} ms, round-trip ${(performance.now() - t).toFixed(1)} ms`,
      );
      append(open.journalMode === 'wal' ? 'PASS WAL mode active' : `FAIL expected WAL, got ${open.journalMode}`);

      t = performance.now();
      const write = await spikeIpc.sqliteWrite(ROWS);
      append(
        `write ${write.rows.toLocaleString('en-US')} rows (1 transaction): rust ${write.rustMs.toFixed(1)} ms, round-trip ${(performance.now() - t).toFixed(1)} ms`,
      );

      t = performance.now();
      const read = await spikeIpc.sqliteRead();
      const roundTrip = performance.now() - t;
      append(
        `read ${read.rows.length.toLocaleString('en-US')} rows: rust query ${read.rustMs.toFixed(1)} ms, round-trip incl. IPC + JSON ${roundTrip.toFixed(1)} ms (IPC/serialize ≈ ${(roundTrip - read.rustMs).toFixed(1)} ms)`,
      );

      const jsSum = read.rows.reduce((sum, row) => sum + row.amountMinor, 0);
      const allIntegers = read.rows.every((row) => Number.isSafeInteger(row.amountMinor));
      const ok = read.rows.length === ROWS && allIntegers && jsSum === write.amountSum && jsSum === read.amountSum;
      append(
        `${ok ? 'PASS' : 'FAIL'} integrity: count ${String(read.rows.length)}, all safe integers ${String(allIntegers)}, sum written ${String(write.amountSum)} = sum in SQL ${String(read.amountSum)} = sum in JS ${String(jsSum)}`,
      );
    } catch (error: unknown) {
      append(`FAIL ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>(a) SQLite read/write through Tauri commands</h2>
      <p>
        Opens <code>spike.sqlite</code> (throwaway table, not the HAFB schema), writes {ROWS.toLocaleString('en-US')} rows in
        one transaction, reads them all back into JS, and checks integer amounts survive the round-trip exactly. Run it
        twice: the second run includes replacing existing rows.
      </p>
      <div className="controls">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void runAll();
          }}
        >
          Run SQLite spike
        </button>
      </div>
      {log.length > 0 && <pre>{log.join('\n')}</pre>}
    </section>
  );
}
