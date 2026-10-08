import { useEffect, useState, useSyncExternalStore } from 'react';
import { session } from './session.ts';

/** No plan open: create, open, import, or pick a recent file. */
export function PlanHome() {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [name, setName] = useState('My Plan');
  const busy = state.busy !== null;

  useEffect(() => {
    void session.refreshRecent();
  }, []);

  return (
    <main className="plan-home">
      <h1>HAFB</h1>
      <p className="muted">Phase 2 plan files. The real Plan screen arrives in Phase 3–4.</p>

      <section>
        <h2>Start</h2>
        <div className="row">
          <label>
            New plan name{' '}
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <button type="button" disabled={busy || name.trim() === ''} onClick={() => void session.createNew(name.trim())}>
            New plan…
          </button>
        </div>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void session.openDialog()}>
            Open plan…
          </button>
          <button type="button" disabled={busy} onClick={() => void session.importExport()}>
            Import YNAB export (.zip)…
          </button>
          {state.busy !== null && <span className="muted">{state.busy}</span>}
        </div>
      </section>

      <section>
        <h2>Recent plans</h2>
        {state.recent.length === 0 && <p className="muted">None yet.</p>}
        <ul className="recent">
          {state.recent.map((r) => (
            <li key={r.path}>
              <button type="button" className="link" disabled={busy || !r.exists} onClick={() => void session.openPath(r.path)}>
                {r.path}
              </button>
              {!r.exists && <span className="muted"> (missing)</span>}
              <button type="button" className="small" aria-label={`Remove ${r.path} from recent plans`} onClick={() => void session.removeRecent(r.path)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p>
        <a href="#/design">Design mockups (S3.1) →</a>
      </p>
      <p>
        <a href="#/spike">Phase 0 spike screens →</a>
      </p>
    </main>
  );
}
