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

## Amendment (2026-10-08): whole-UI themes, not just colours

Sarg asked whether a theme can change the whole UI: the Till Roll receipt look (monospace money, dashed and double rules, torn paper edges, dotted leaders), not just its colours. Yes. To keep that easy, the theme contract grows from colours to a **skin**.

**A theme may change:**
1. **Colour:** the tokens above.
2. **Typography:**
   - Font family per role: UI text, display, money figures, labels.
   - Weights, letter case and tracking for headings and column headers.
   - Numeral style.
3. **Shape:**
   - Radii and border widths and styles.
   - Rule styles: group dividers solid or dashed, totals single or double.
   - Pill style: rounded pill, box, or plain text with an outline.
   - Progress-bar style: segment gap, height, caps.
4. **Density:** row heights (within limits, see below) and the spacing scale.
5. **Ornament:** an optional scoped stylesheet (`[data-theme='till-roll'] …`) for effects tokens can't express: a torn-edge mask on the plan sheet, dotted leaders in the inspector, paper texture.
   - Ornament may only style what's already there.
   - It never adds or removes content, changes reading order, or hides data.

**Fixed for every theme:**
- The layout and information architecture (YNAB's structure: sidebar, plan grid columns, inspector, register).
- Behaviour, keyboard model and accessibility semantics.

Themes are skins, not layouts.

**How this is kept true:**
- S3.2 builds every component against shape, type and density tokens as well as colour. No component hard-codes a radius, font or rule style.
- The theme test extends to the new token groups:
  - Text at least 12 px.
  - Rows at least 28 px.
  - Focus outline at least 2 px.
  - Contrast as before.
- **S3.2 exit check:** a rough **Till Roll proof theme** built *only* from tokens plus an ornament sheet, with no component edits. If the proof needs a component change, the contract is wrong and gets fixed before more screens are built on it.
