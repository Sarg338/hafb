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

export interface Theme {
  id: string;
  name: string;
  /** Tells the webview which native controls and scrollbars to draw. */
  scheme: 'light' | 'dark';
  /** System-colour themes (high contrast) are exempt from computed contrast checks: Windows owns them. */
  system?: boolean;
  colors: Readonly<Record<ColorToken, string>>;
}

/** CSS custom property for a token: `accentSoft` → `--c-accent-soft`. */
export function cssVar(token: ColorToken): string {
  return `--c-${token.replace(/[A-Z0-9]/g, (ch) => `-${ch.toLowerCase()}`)}`;
}

/** Apply a theme to the document root. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const token of COLOR_TOKENS) root.style.setProperty(cssVar(token), theme.colors[token]);
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
}
