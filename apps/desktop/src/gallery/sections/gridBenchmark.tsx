// Gallery: the 50,000-row scroll benchmark on the production DataGrid.
// Deep link #/gallery?section=grid-benchmark&bench=run runs it after mount; results are in
// #bench-result (text, plus JSON in data-result; data-state="done" when finished).
import { useMemo } from 'react';
import { GridBenchmark } from '../bench/GridBenchmark.tsx';
import type { GallerySection } from '../Gallery.tsx';

function GridBenchmarkSection() {
  const autoRun = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('bench') === 'run', []);
  return <GridBenchmark autoRun={autoRun} />;
}

export const section: GallerySection = { id: 'grid-benchmark', title: 'Grid benchmark (50k rows)', order: 95, Component: GridBenchmarkSection };
