// Feasibility proof for whole-UI themes (ADR 0003 amendment): a test-only theme, never shipped or
// selectable, changes every type, shape, density, motion and variant token and adds an ornament.
// applyTheme must hand every one of those values to the page. Combined with sourceScan.test.ts
// (components read only tokens), this proves a future skin needs no component edits.
import { describe, expect, it } from 'vitest';
import { lightTheme } from './themes.ts';
import {
  applyTheme,
  DENSITY_DEFAULTS,
  MOTION_DEFAULTS,
  ORNAMENT_STYLE_ID,
  SHAPE_DEFAULTS,
  tokenVar,
  TYPE_DEFAULTS,
  type DensityTokens,
  type MotionTokens,
  type ShapeTokens,
  type Theme,
  type ThemeRoot,
  type TypeTokens,
} from './tokens.ts';
import { validateTheme } from './validate.ts';

/** A value per key that differs from the default, so the test can see it arrive. */
function changed<K extends string>(defaults: Readonly<Record<K, string>>, mutate: (key: K, value: string) => string): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(defaults) as K[]) out[key] = mutate(key, defaults[key]);
  return out;
}
const bump = (value: string): string => {
  const m = /^(\d+(?:\.\d+)?)(px|ms)$/.exec(value);
  return m ? `${String(Number(m[1]) + 1)}${m[2] ?? ''}` : value;
};

const fixture: Theme = {
  ...lightTheme,
  id: 'test-fixture-skin',
  name: 'Fixture (tests only)',
  type: changed<keyof TypeTokens>(TYPE_DEFAULTS, (k, v) => (k.startsWith('font') ? "'Cascadia Mono', monospace" : k === 'labelTransform' ? 'none' : bump(v) === v ? `${v} ` : bump(v))),
  shape: changed<keyof ShapeTokens>(SHAPE_DEFAULTS, (k, v) => (k.endsWith('Style') ? 'double' : bump(v))),
  density: changed<keyof DensityTokens>(DENSITY_DEFAULTS, (_k, v) => bump(v)),
  motion: changed<keyof MotionTokens>(MOTION_DEFAULTS, (k, v) => (k === 'ease' ? 'linear' : bump(v))),
  variants: { pill: 'text' },
  ornament: '.hd-planhead { background-image: repeating-linear-gradient(90deg, transparent 0 4px, var(--c-border) 4px 5px); }',
};

function recorder(): ThemeRoot & { props: Map<string, string> } {
  const props = new Map<string, string>();
  return { props, style: { setProperty: (n: string, v: string) => props.set(n, v), colorScheme: '' }, dataset: {} };
}

function fakeDocument(): { doc: Document; styles: { id: string; textContent: string | null }[] } {
  const styles: { id: string; textContent: string | null; remove: () => void }[] = [];
  const doc = {
    getElementById: (id: string) => styles.find((s) => s.id === id) ?? null,
    createElement: () => {
      const el = { id: '', textContent: null as string | null, remove: () => styles.splice(styles.indexOf(el), 1) };
      return el;
    },
    head: { appendChild: <T,>(el: T) => (styles.push(el as never), el) },
  } as unknown as Document;
  return { doc, styles };
}

describe('a whole-UI skin reaches the page through tokens alone', () => {
  it('every non-colour token takes the fixture value', () => {
    const root = recorder();
    applyTheme(fixture, root, null);
    const groups: [Record<string, string>, (k: never) => string][] = [
      [fixture.type ?? {}, tokenVar.type],
      [fixture.shape ?? {}, tokenVar.shape],
      [fixture.density ?? {}, tokenVar.density],
      [fixture.motion ?? {}, tokenVar.motion],
    ];
    let checked = 0;
    for (const [values, name] of groups) {
      for (const [k, v] of Object.entries(values)) {
        expect(root.props.get(name(k as never)), k).toBe(v);
        checked += 1;
      }
    }
    expect(checked).toBe(Object.keys(TYPE_DEFAULTS).length + Object.keys(SHAPE_DEFAULTS).length + Object.keys(DENSITY_DEFAULTS).length + Object.keys(MOTION_DEFAULTS).length);
  });

  it('variant tokens become data attributes', () => {
    const root = recorder();
    applyTheme(fixture, root, null);
    expect(root.dataset).toMatchObject({ theme: 'test-fixture-skin', pill: 'text' });
  });

  it('the ornament sheet is injected, replaced and removed with the theme', () => {
    const { doc, styles } = fakeDocument();
    applyTheme(fixture, recorder(), doc);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.id).toBe(ORNAMENT_STYLE_ID);
    expect(styles[0]?.textContent).toBe(fixture.ornament);
    applyTheme(lightTheme, recorder(), doc);
    expect(styles).toHaveLength(0);
  });

  it('the fixture skin is still a valid theme (a skin keeps the floors and contrast)', () => {
    expect(validateTheme(fixture)).toEqual([]);
  });
});
