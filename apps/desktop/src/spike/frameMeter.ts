// requestAnimationFrame drivers for the grid spike. Each records the interval between
// consecutive frames (rAF timestamps), which is what the user perceives as smoothness.
import { median } from './frameStats.ts';

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Idle refresh interval: median of `frames` rAF intervals with nothing else happening. */
export async function measureRefreshInterval(frames = 60): Promise<number> {
  const deltas: number[] = [];
  let last = await nextFrame();
  for (let i = 0; i < frames; i += 1) {
    const now = await nextFrame();
    deltas.push(now - last);
    last = now;
  }
  return median(deltas);
}

export type ScrollPlan =
  | { kind: 'steady'; pxPerSecond: number; durationMs: number }
  | { kind: 'fling'; durationMs: number };

/**
 * Scrolls `el` programmatically, one step per frame, from the top. Programmatic scrollTop
 * forces main-thread work every frame (React re-render of the visible rows), which is the
 * worst case; wheel scrolling can be smoother because the compositor helps.
 */
export function runScrollBenchmark(el: HTMLElement, plan: ScrollPlan): Promise<number[]> {
  el.scrollTop = 0;
  const maxScroll = el.scrollHeight - el.clientHeight;
  const pxPerMs = plan.kind === 'steady' ? plan.pxPerSecond / 1000 : maxScroll / plan.durationMs;
  const deltas: number[] = [];

  return new Promise((resolve) => {
    let start: number | undefined;
    let last = 0;
    const step = (now: number) => {
      if (start === undefined) {
        start = now;
      } else {
        deltas.push(now - last);
      }
      last = now;
      const elapsed = now - start;
      el.scrollTop = Math.min(maxScroll, elapsed * pxPerMs);
      if (elapsed >= plan.durationMs) {
        resolve(deltas);
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}

/** Records frame intervals for `durationMs` while the user scrolls by hand. */
export function recordFrames(durationMs: number): Promise<number[]> {
  const deltas: number[] = [];
  return new Promise((resolve) => {
    let start: number | undefined;
    let last = 0;
    const step = (now: number) => {
      if (start === undefined) {
        start = now;
      } else {
        deltas.push(now - last);
      }
      last = now;
      if (now - start >= durationMs) {
        resolve(deltas);
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}
