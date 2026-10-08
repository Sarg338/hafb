import { useEffect, useState } from 'react';
import { spikeIpc, type TitlebarMode } from './ipc.ts';

export function TitlebarSpike() {
  const [mode, setMode] = useState<TitlebarMode | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    spikeIpc.getTitlebarMode().then(setMode, (e: unknown) => {
      setError(String(e));
    });
  }, []);

  const other: TitlebarMode = mode === 'native' ? 'custom' : 'native';

  return (
    <section>
      <h2>(c) Title bar: snap layouts and Win+Arrow</h2>
      <p>
        Current mode: <strong>{mode ?? '…'}</strong>
        {mode === 'custom' && ' (HTML title bar + tauri-plugin-frame native overlay on the maximize button)'}
        {mode === 'native' && ' (Windows-drawn title bar: the fallback allowed by CLAUDE.md §6.14)'}
      </p>
      {error && <p className="bad">{error}</p>}
      <div className="controls">
        <button
          type="button"
          disabled={mode === null}
          onClick={() => {
            spikeIpc.setTitlebarMode(other).catch((e: unknown) => {
              setError(String(e));
            });
          }}
        >
          Switch to {other} title bar (restarts app)
        </button>
      </div>
      <p>Check each of these in the current mode:</p>
      <ol>
        <li>Hover the maximize button for about 1 s: the Windows 11 Snap Layouts flyout appears. Pick a layout; the window snaps into it.</li>
        <li>Win+Z opens the same flyout.</li>
        <li>Win+← / Win+→ snap to half screen; Win+↑ maximizes; Win+↓ restores, then minimizes.</li>
        <li>Drag the title bar to the top edge of the screen: the snap bar appears; drop on a zone and it snaps.</li>
        <li>Drag the title bar to a screen edge (Aero Snap) and to another monitor (if you have one).</li>
        <li>Double-click the title bar: maximizes; again: restores.</li>
        <li>Minimize, maximize/restore and close buttons each work with one click; hover colors look right.</li>
        <li>Resize from all four edges and corners. Windows 11 rounded corners and shadow are present.</li>
        <li>Repeat 1 and 8 at 150% display scaling (Settings → Display → Scale) if you can.</li>
      </ol>
    </section>
  );
}
