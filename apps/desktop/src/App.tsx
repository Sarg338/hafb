import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { DesignApp } from './design/DesignApp.tsx';
import { buildSamplePlan } from './design/sample.ts';
import { Gallery } from './gallery/Gallery.tsx';
import { appIpc, type LaunchTiming } from './shell/ipc.ts';
import { useRoute } from './shell/router.ts';
import { session } from './shell/session.ts';
import { Shell } from './shell/Shell.tsx';
import { ConfirmProvider } from './ui/Dialog.tsx';
import { ToastProvider } from './ui/Toast.tsx';
import './ui/base.css';

declare global {
  interface Window {
    /** Launch timings once the first frame is painted (perf checks and the smoke suite read it). */
    hafbLaunchTiming?: LaunchTiming;
  }
}

/** Once per app start: title bar mode, first-paint timing, and the plan to open. */
function useStartup(): void {
  useEffect(() => {
    if (!isTauri()) {
      // Browser preview (Vite dev server): no plan files exist, so show the sample household.
      if (!session.getState().open) session.openInMemory(buildSamplePlan().plan, 'Sample data (browser preview)');
      return;
    }
    appIpc.getTitlebarMode().then(
      (mode) => {
        document.documentElement.classList.toggle('native-titlebar', mode === 'native');
      },
      () => undefined,
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        appIpc.launchTiming().then(
          (t) => {
            window.hafbLaunchTiming = t;
          },
          () => undefined,
        );
      });
    });
    appIpc.startupPlanPath().then(
      (path) => {
        if (path !== null) void session.openPath(path);
      },
      () => undefined,
    );
  }, []);
}

export function App() {
  const route = useRoute();
  useStartup();
  return (
    <ToastProvider>
      <ConfirmProvider>{route.kind === 'dev' ? route.page === 'design' ? <DesignApp /> : <Gallery /> : <Shell />}</ConfirmProvider>
    </ToastProvider>
  );
}
