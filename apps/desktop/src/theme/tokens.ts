// Theme tokens (S3.1). Components use only these semantic names, never raw colours, so a theme
// is plain data: a map from token to colour. Built-in themes live in themes.ts; user themes later
// use the same shape and pass the same contrast checks (theme.test.ts).

export const COLOR_TOKENS = [
  // Surfaces
  'app', // window ground behind everything
  'titlebar',
  'sidebar',
  'sidebarHover',
  'sidebarSelected',
  'sidebarText',
  'sidebarMuted',
  'surface', // main work surface (plan grid, register)
  'surfaceAlt', // group rows, table headers
  'raised', // popovers, menus, inspector cards
  'hover',
  'selected',
  'selectedBorder',
  'selectedText',
  'input',
  'inputBorder',
  'border',
  'borderStrong',
  // Text
  'text',
  'textMuted',
  'textSubtle',
  'textOnAccent',
  'link',
  // Accent (HAFB's own hue: selection, primary actions)
  'accent',
  'accentHover',
  'accentSoft',
  'focus',
  // Money state: Available pills (fg on bg must pass 4.5:1)
  'fundedBg',
  'fundedFg',
  'underfundedBg',
  'underfundedFg',
  'overspentBg',
  'overspentFg',
  'zeroBg',
  'zeroFg',
  // Progress bars: dark = available/assigned, light = spent, track = empty
  'barTrack',
  'barFunded',
  'barFundedSpent',
  'barUnderfunded',
  'barUnderfundedSpent',
  'barOverspent',
  'barSnoozed',
  // Ready to Assign banner
  'rtaPositiveBg',
  'rtaPositiveFg',
  'rtaZeroBg',
  'rtaZeroFg',
  'rtaNegativeBg',
  'rtaNegativeFg',
  // Plain negative money in tables (not a pill)
  'negative',
  // Status text drawn on ordinary surfaces (target messages): never a pill's fg off its own bg
  'warnText',
  'badText',
  // Charts (Reflect): eight distinguishable series plus income/expense/net
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
  'chart6',
  'chart7',
  'chart8',
  'chartIncome',
  'chartExpense',
  'chartNet',
  'chartGrid',
  // Flags (YNAB's six)
  'flagRed',
  'flagOrange',
  'flagYellow',
  'flagGreen',
  'flagBlue',
  'flagPurple',
  // Depth
  'shadow',
  'scrim',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

// ---- non-colour tokens (ADR 0003 amendment, ADR 0004) --------------------------------------------
// Defaults are the approved S3.1 values (DESIGN.md). A theme may override any of them; the built-in
// themes override none, so today's look is exactly the defaults.

export const TYPE_DEFAULTS = {
  fontUi: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  fontDisplay: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
  /** Money figures (tabular numerals are always on). */
  fontMoney: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  /** Column headers and small labels. */
  fontLabel: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  sizeMicro: '11.5px',
  sizeCaption: '12px',
  sizeSmall: '12.5px',
  sizeBody: '13px',
  sizeNav: '13.5px',
  sizeHeading: '14px',
  sizeSubtitle: '16px',
  sizeTitle: '20px',
  sizeDisplay: '22px',
  sizeDisplayLarge: '24px',
  lineHeight: '1.35',
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightStrong: '650',
  labelTransform: 'uppercase',
  labelTracking: '0.04em',
  labelWeight: '600',
  displayTracking: '-0.01em',
} as const satisfies Record<string, string>;

export const SHAPE_DEFAULTS = {
  radiusTiny: '2px',
  radiusSmall: '3px',
  radius: '4px',
  radiusMedium: '6px',
  radiusLarge: '8px',
  radiusPill: '999px',
  borderWidth: '1px',
  /** Divider between category groups and register sections: solid | dashed | dotted. */
  groupRuleStyle: 'solid',
  /** Rule above totals (inspector summary, report totals). */
  totalRuleStyle: 'solid',
  totalRuleWidth: '1px',
  /** Split lines under their transaction. */
  subRuleStyle: 'dashed',
  /** Disabled inputs and empty-state frames. */
  mutedBorderStyle: 'dashed',
  barHeight: '5px',
  barGap: '2px',
  barRadius: '3px',
  focusWidth: '2px',
} as const satisfies Record<string, string>;

export const DENSITY_DEFAULTS = {
  rowPlan: '34px',
  rowRegister: '30px',
  rowGroup: '36px',
  rowHeader: '32px',
  control: '32px',
  /** Toolbar and icon buttons. */
  controlCompact: '30px',
  /** Filter chips, small buttons. */
  chip: '28px',
  controlSmall: '26px',
  space1: '2px',
  space2: '4px',
  space3: '8px',
  space4: '12px',
  space5: '16px',
  space6: '24px',
  sidebarWidth: '252px',
  inspectorWidth: '328px',
} as const satisfies Record<string, string>;

export const MOTION_DEFAULTS = {
  fast: '120ms',
  move: '180ms',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const satisfies Record<string, string>;

export type PillVariant = 'filled' | 'outlined' | 'text';

/** Categorical choices, exposed as `data-*` attributes on the root for CSS to select on. */
export interface VariantTokens {
  /** Available pill: rounded filled pill (approved), outlined pill, or plain coloured text. */
  pill: PillVariant;
}

export const VARIANT_DEFAULTS: VariantTokens = { pill: 'filled' };

export type TypeTokens = Record<keyof typeof TYPE_DEFAULTS, string>;
export type ShapeTokens = Record<keyof typeof SHAPE_DEFAULTS, string>;
export type DensityTokens = Record<keyof typeof DENSITY_DEFAULTS, string>;
export type MotionTokens = Record<keyof typeof MOTION_DEFAULTS, string>;

export interface Theme {
  id: string;
  name: string;
  /** Tells the webview which native controls and scrollbars to draw. */
  scheme: 'light' | 'dark';
  /** System-colour themes (high contrast) are exempt from computed contrast checks: Windows owns them. */
  system?: boolean;
  colors: Readonly<Record<ColorToken, string>>;
  /** Overrides of the non-colour defaults. The built-in themes leave these out. */
  type?: Partial<TypeTokens>;
  shape?: Partial<ShapeTokens>;
  density?: Partial<DensityTokens>;
  motion?: Partial<MotionTokens>;
  variants?: Partial<VariantTokens>;
  /**
   * Optional stylesheet for effects tokens can't express (ADR 0003 amendment). It may only style
   * what exists: never add or remove content, reorder, or hide data.
   */
  ornament?: string;
}

export interface ResolvedTheme {
  id: string;
  scheme: 'light' | 'dark';
  /** Custom property → value, every token filled in. */
  vars: Record<string, string>;
  /** `data-*` attributes for the root. */
  data: Record<string, string>;
  ornament: string;
}

const kebab = (name: string): string => name.replace(/[A-Z0-9]/g, (ch) => `-${ch.toLowerCase()}`);

/** CSS custom property for a colour token: `accentSoft` → `--c-accent-soft`. */
export function cssVar(token: ColorToken): string {
  return `--c-${kebab(token)}`;
}

/** Custom properties for the non-colour groups: `--t-font-ui`, `--s-radius`, `--d-row-plan`, `--m-move`. */
export const tokenVar = {
  type: (k: keyof TypeTokens): string => `--t-${kebab(k)}`,
  shape: (k: keyof ShapeTokens): string => `--s-${kebab(k)}`,
  density: (k: keyof DensityTokens): string => `--d-${kebab(k)}`,
  motion: (k: keyof MotionTokens): string => `--m-${kebab(k)}`,
};

function filled<K extends string>(defaults: Readonly<Record<K, string>>, overrides: Partial<Record<K, string>> | undefined): [K, string][] {
  const keys = Object.keys(defaults).filter((k): k is K => k in defaults);
  return keys.map((k) => [k, overrides?.[k] ?? defaults[k]]);
}

/** Every custom property and data attribute a theme sets, defaults filled in. Pure. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  const vars: Record<string, string> = {};
  for (const token of COLOR_TOKENS) vars[cssVar(token)] = theme.colors[token];
  for (const [k, v] of filled(TYPE_DEFAULTS, theme.type)) vars[tokenVar.type(k)] = v;
  for (const [k, v] of filled(SHAPE_DEFAULTS, theme.shape)) vars[tokenVar.shape(k)] = v;
  for (const [k, v] of filled(DENSITY_DEFAULTS, theme.density)) vars[tokenVar.density(k)] = v;
  for (const [k, v] of filled(MOTION_DEFAULTS, theme.motion)) vars[tokenVar.motion(k)] = v;
  const data = { theme: theme.id, pill: theme.variants?.pill ?? VARIANT_DEFAULTS.pill };
  return { id: theme.id, scheme: theme.scheme, vars, data, ornament: theme.ornament ?? '' };
}

/** The DOM surface applyTheme needs (a test double can record what a theme sets). */
export interface ThemeRoot {
  style: { setProperty: (name: string, value: string) => void; colorScheme: string };
  dataset: Record<string, string | undefined>;
}

export const ORNAMENT_STYLE_ID = 'hafb-ornament';

/** Apply a theme to the document root (or a test double); manages the ornament stylesheet. */
export function applyTheme(theme: Theme, root: ThemeRoot = document.documentElement, doc: Document | null = typeof document === 'undefined' ? null : document): ResolvedTheme {
  const resolved = resolveTheme(theme);
  for (const [name, value] of Object.entries(resolved.vars)) root.style.setProperty(name, value);
  root.style.colorScheme = resolved.scheme;
  for (const [key, value] of Object.entries(resolved.data)) root.dataset[key] = value;
  if (doc) {
    const existing = doc.getElementById(ORNAMENT_STYLE_ID);
    if (resolved.ornament === '') {
      existing?.remove();
    } else {
      const style = existing ?? doc.head.appendChild(doc.createElement('style'));
      style.id = ORNAMENT_STYLE_ID;
      style.textContent = resolved.ornament;
    }
  }
  return resolved;
}
