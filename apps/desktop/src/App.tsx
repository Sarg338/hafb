import { useEffect, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { spikeIpc } from './spike/ipc.ts';
import { markFirstPaintOnce } from './spike/launchTiming.ts';
import { SpikePage } from './spike/SpikePage.tsx';
import { DesignApp } from './design/DesignApp.tsx';
import { Gallery } from './gallery/Gallery.tsx';
import { PlanHome } from './plan/PlanHome.tsx';
import { PlanView } from './plan/PlanView.tsx';
import { ToastHost } from './plan/ToastHost.tsx';
import { session } from './plan/session.ts';

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

  if (hash.startsWith('#/gallery')) {
    return <Gallery />;
  }

  if (hash.startsWith('#/design')) {
    return <DesignApp />;
  }

  if (hash.startsWith('#/spike')) {
    return <SpikePage />;
  }

  return <PlanScreens />;
}

function PlanScreens() {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return (
    <>
      {state.open ? <PlanView open={state.open} /> : <PlanHome />}
      <ToastHost toast={state.toast} />
    </>
  );
}
