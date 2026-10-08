// Animate an integer toward its new value: the signature "cause and effect" motion (DESIGN.md),
// used for Ready to Assign and Available amounts. The duration is the theme's --m-move token.
import { useEffect, useRef, useState } from 'react';

function moveMs(): number {
  if (typeof document === 'undefined') return 180;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--m-move').trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 180;
  return raw.endsWith('ms') ? n : n * 1000;
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useTweened(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const reduced = reducedMotion();
  useEffect(() => {
    const from = shownRef.current;
    if (from === value || reduced) {
      shownRef.current = value;
      return;
    }
    const duration = moveMs();
    const start = performance.now();
    let raf = 0;
    const step = (t: number): void => {
      const k = Math.min(1, (t - start) / duration);
      const v = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Frames don't run in hidden or minimised windows: always land on the true value.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      shownRef.current = value;
      setShown(value);
    }, duration + 40);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [value, reduced]);
  return reduced ? value : shown;
}
