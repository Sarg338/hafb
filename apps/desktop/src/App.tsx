import { lazy, Suspense, useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { buildBlankPlan, buildSamplePlan } from './design/sample.ts';
import { appIpc, type LaunchTiming } from './shell/ipc.ts';
import { useRoute } from './shell/router.ts';
import { session } from './shell/session.ts';
import { Shell, type OpenTiming } from './shell/Shell.tsx';
import { prefs, usePrefs } from './shell/prefs.ts';
import { ConfirmProvider } from './ui/Dialog.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { installGlobalErrorHandlers } from './ui/errors.ts';
import { ShortcutProvider } from './ui/shortcuts/ShortcutProvider.tsx';
import { ToastProvider, useToast } from './ui/Toast.tsx';
import './ui/base.css';

// Dev pages (S3.1 mockups, component gallery) load on demand: their stylesheets stay out of the app.
const DesignApp = lazy(() => import('./design/DesignApp.tsx').then((m) => ({ default: m.DesignApp })));
const Gallery = lazy(() => import('./gallery/Gallery.tsx').then((m) => ({ default: m.Gallery })));

declare global {
  interface Window {
    /** Launch timings once the first frame is painted (perf checks and the smoke suite read it). */
    hafbLaunchTiming?: LaunchTiming;
    /** The last plan opened, once its first frame painted (S8.1). */
    hafbOpenTiming?: OpenTiming;
  }
}

/** Once per app start: title bar mode and first-paint timing (or the browser preview's sample plan). */
function useStartup(): void {
  useEffect(() => {
    if (!isTauri()) {
      // Browser preview (Vite dev server): no plan files exist, so show the sample household.
      // `?welcome` shows the first-run screen and `?blank` an empty new plan (S7.5 checks).
      const query = new URLSearchParams(window.location.search);
      if (query.has('welcome')) return;
      if (!session.getState().open) session.openInMemory(query.has('blank') ? buildBlankPlan() : buildSamplePlan().plan, query.has('blank') ? 'Empty plan (browser preview)' : 'Sample data (browser preview)');
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
    // The plan named at launch is already opening (main.tsx, session.openAtLaunch).
  }, []);
}

/** Unexpected errors anywhere (window errors, rejected promises) become an error toast. */
function GlobalErrors() {
  const { toast } = useToast();
  useEffect(
    () =>
      installGlobalErrorHandlers((d) => {
        toast({ text: `${d.title}. ${d.message}`, tone: 'error' });
      }),
    [toast],
  );
  return null;
}

export function App() {
  const route = useRoute();
  const p = usePrefs();
  useStartup();
  return (
    <ErrorBoundary area="HAFB">
      <ToastProvider>
        <ConfirmProvider>
          <ShortcutProvider
            enabled={p.shortcutsOn}
            onEnabledChange={(on) => {
              prefs.update({ shortcutsOn: on });
            }}
          >
            <GlobalErrors />
            {route.kind === 'dev' ? <Suspense fallback={null}>{route.page === 'design' ? <DesignApp /> : <Gallery />}</Suspense> : <Shell />}
          </ShortcutProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
