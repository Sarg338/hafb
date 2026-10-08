import { useEffect, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { spikeIpc } from './spike/ipc.ts';
import { markFirstPaintOnce } from './spike/launchTiming.ts';
import { SpikePage } from './spike/SpikePage.tsx';

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

function readHash(): string {
  return window.location.hash;
}

export function App() {
  const hash = useSyncExternalStore(subscribeToHash, readHash);

  useEffect(() => {
    markFirstPaintOnce();
    if (isTauri()) {
      spikeIpc.getTitlebarMode().then(
        (mode) => {
          document.documentElement.classList.toggle('native-titlebar', mode === 'native');
        },
        () => undefined,
      );
    }
  }, []);

  if (hash.startsWith('#/spike')) {
    return <SpikePage />;
  }

  return (
    <main className="home">
      <h1>HAFB</h1>
      <p>Phase 0: stack spike. There are no budget features yet.</p>
      <p>
        <a href="#/spike">Open the spike screens →</a>
      </p>
    </main>
  );
}
