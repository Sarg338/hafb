// A chart as a PNG (Reflect export, Share Your Progress). The SVG is cloned with every computed
// style written inline, so theme tokens and the no-colour patterns survive outside the page, then
// drawn onto a canvas at 2× or more for high-DPI screens. Nothing leaves the machine: the bytes go
// to the native Save dialog.

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linejoin',
  'stroke-linecap',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-variant-numeric',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'visibility',
] as const;

function inlineStyles(source: Element, target: Element): void {
  const cs = getComputedStyle(source);
  const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
  target.setAttribute('style', style);
  target.removeAttribute('class');
  const s = source.children;
  const t = target.children;
  for (let i = 0; i < s.length && i < t.length; i += 1) {
    const a = s[i];
    const b = t[i];
    if (a && b) inlineStyles(a, b);
  }
}

export interface ChartImageOptions {
  /** Heading drawn above the chart (report name, range). */
  title?: string;
  subtitle?: string;
  /** Pixel density; at least 2 so the image is sharp on high-DPI screens. */
  scale?: number;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** An on-screen SVG as a decoded image, styles inlined. */
async function svgImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGSVGElement)) throw new Error('Not a chart.');
  inlineStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  // Pattern fills (differentiate without colour) live in a shared <defs>; carry them along.
  const patterns = document.querySelector('svg[data-series-patterns] defs');
  if (patterns) {
    const defs = patterns.cloneNode(true);
    if (defs instanceof Element) {
      inlineStyles(patterns, defs);
      clone.insertBefore(defs, clone.firstChild);
    }
  }
  const markup = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  image.decoding = 'sync';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error('The chart could not be drawn.'));
    };
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await loaded;
  return image;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) throw new Error('The chart could not be drawn.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** A composed SVG (Share Your Progress) at an exact pixel size. */
export async function svgPng(svg: SVGSVGElement, pixels: { width: number; height: number }): Promise<Uint8Array> {
  const box = svg.viewBox.baseVal;
  const image = await svgImage(svg, box.width, box.height);
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The image could not be drawn.');
  ctx.drawImage(image, 0, 0, pixels.width, pixels.height);
  return canvasPng(canvas);
}

/** Render an on-screen chart to PNG bytes, with a heading. */
export async function chartPng(svg: SVGSVGElement, options: ChartImageOptions = {}): Promise<Uint8Array> {
  const box = svg.viewBox.baseVal;
  const width = box.width > 0 ? box.width : svg.clientWidth;
  const height = box.height > 0 ? box.height : svg.clientHeight;
  const scale = Math.max(2, Math.ceil(options.scale ?? window.devicePixelRatio));
  const image = await svgImage(svg, width, height);

  const pad = 24;
  const head = options.title === undefined ? 0 : options.subtitle === undefined ? 40 : 60;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((width + pad * 2) * scale);
  canvas.height = Math.round((height + pad * 2 + head) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The chart could not be drawn.');
  ctx.scale(scale, scale);
  ctx.fillStyle = cssVar('--c-surface') || getComputedStyle(document.body).backgroundColor;
  ctx.fillRect(0, 0, width + pad * 2, height + pad * 2 + head);
  const font = cssVar('--t-font-display') || 'sans-serif';
  if (options.title !== undefined) {
    ctx.fillStyle = cssVar('--c-text');
    ctx.font = `600 20px ${font}`;
    ctx.textBaseline = 'top';
    ctx.fillText(options.title, pad, pad);
    if (options.subtitle !== undefined) {
      ctx.fillStyle = cssVar('--c-text-muted');
      ctx.font = `400 13px ${cssVar('--t-font-ui') || font}`;
      ctx.fillText(options.subtitle, pad, pad + 28);
    }
  }
  ctx.drawImage(image, pad, pad + head, width, height);
  return canvasPng(canvas);
}
