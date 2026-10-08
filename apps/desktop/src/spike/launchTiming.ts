import { isTauri } from '@tauri-apps/api/core';
import { spikeIpc, type LaunchInfo } from './ipc.ts';

export interface FirstPaintTiming extends LaunchInfo {
  /** performance.now() at first paint: WebView2 navigation start → first painted frame. */
  webviewToFirstPaintMs: number;
}

let started = false;
let resolveTiming: (timing: FirstPaintTiming) => void = () => undefined;
let rejectTiming: (reason: unknown) => void = () => undefined;

export const firstPaintTiming = new Promise<FirstPaintTiming>((resolve, reject) => {
  resolveTiming = resolve;
  rejectTiming = reject;
});

/**
 * Records launch timing once, after the first frame that contains React content has been
 * painted (two rAFs after the first commit). StrictMode's double effects are ignored.
 */
export function markFirstPaintOnce(): void {
  if (started) return;
  started = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const webviewToFirstPaintMs = performance.now();
      if (!isTauri()) {
        rejectTiming(new Error('Not running inside Tauri (plain browser): no process timing.'));
        return;
      }
      spikeIpc.markFirstPaint().then(
        (info) => {
          resolveTiming({ ...info, webviewToFirstPaintMs });
        },
        (error: unknown) => {
          rejectTiming(error);
        },
      );
    });
  });
}
