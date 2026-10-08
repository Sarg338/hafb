import { useEffect, useState } from 'react';
import { getTauriVersion } from '@tauri-apps/api/app';
import { firstPaintTiming, type FirstPaintTiming } from './launchTiming.ts';

const ms = (value: number | null) => (value === null ? 'n/a' : `${value.toFixed(0)} ms`);

export function LaunchSpike() {
  const [timing, setTiming] = useState<FirstPaintTiming | null>(null);
  const [tauriVersion, setTauriVersion] = useState('…');
  const [error, setError] = useState('');

  useEffect(() => {
    firstPaintTiming.then(setTiming, (e: unknown) => {
      setError(String(e));
    });
    getTauriVersion().then(setTauriVersion, () => {
      setTauriVersion('n/a');
    });
  }, []);

  return (
    <section>
      <h2>(d) Launch time and build</h2>
      <p>
        Build: <strong>{import.meta.env.DEV ? 'DEV (pnpm dev): launch numbers are not meaningful' : 'release'}</strong> ·
        Tauri {tauriVersion} · WebView2 {/Edg\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'unknown'}
      </p>
      {error && <p className="bad">{error}</p>}
      {timing && (
        <pre>
          {[
            `process created → Rust main():        ${ms(timing.processToMainMs)}`,
            `process created → first painted UI:   ${ms(timing.processToFirstPaintMs)}   <- report this one`,
            `WebView2 navigation → first paint:    ${ms(timing.webviewToFirstPaintMs)}`,
          ].join('\n')}
        </pre>
      )}
      <p>
        Measured for the screen the app opened on. Close the app and reopen it a few times for cold and warm numbers; the
        first launch after a reboot is the cold one.
      </p>
    </section>
  );
}
