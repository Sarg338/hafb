# ADR 0003 — Themes as data

- **Status:** Accepted (2026-10-08), S3.1.
- **Context:** Sarg chose the familiar, YNAB-like look (PRODUCT.md, Brand Commitments) and asked for the design to "offer themes in the future". The app must also ship light, dark and high contrast, and a "differentiate without colour" option (CLAUDE.md §6.1, §6.14).

## Decision

1. **Semantic colour tokens.**
   - `apps/desktop/src/theme/tokens.ts` lists every colour the UI may use, by role: surfaces, text, accent, money states, progress bars, the Ready to Assign banner, charts, flags, depth.
   - Components use only `var(--c-<token>)`.
   - A raw colour in component CSS is a bug.
2. **A theme is data.**
   - A theme is `{ id, name, scheme, system?, colors: Record<ColorToken, string> }`.
   - `applyTheme()` writes the values as CSS custom properties on the root element and sets `color-scheme`.
   - Adding a theme means adding an object, with no CSS or component changes. Future user themes (a theme picker, imported JSON) use the same shape.
3. **Every built-in or user theme must pass the contrast test** (`theme.test.ts`):
   - 4.5:1 for every text-on-surface pair the UI uses: pills, banner, sidebar, accent buttons.
   - 3:1 for state graphics: progress bars, focus ring, input borders, chart series.
   - A theme that fails is rejected, not shipped.
4. **High contrast uses Windows system colours** (`Canvas`, `CanvasText`, `Highlight`, `Mark`, …), so it follows whichever contrast theme the user picked in Windows. It is exempt from computed checks because Windows owns the values. It forces "differentiate without colour" on.
5. **State never relies on hue alone.**
   - With `data-nocolor`, Available pills gain icons (check, clock, warning, snooze, card) and outline styles.
   - Progress bars gain hatching, and chart series gain patterns.
   - This is a display option for everyone, not only a high-contrast feature.
6. **Non-colour design tokens** (font stacks, row heights, radii, motion) live as CSS custom properties on `.hd` today.
   - They become theme fields only when a real need appears, for example a compact density theme.
   - That's an additive change to the `Theme` type.

## Consequences

- The S3.2 component library inherits the token contract, so no component chooses colours.
- A future "theme editor" is mostly UI: the data model, application and validation already exist.
- An ESLint or Stylelint rule forbidding raw colours outside `theme/` should land with S3.2 (tracked there). Until then, code review and the impeccable design hook catch them.
