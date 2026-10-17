---
name: HAFB
description: The YNAB plan screen people already trust, rebuilt as a calm, dense, first-class Windows app where colour belongs to the state of each dollar.
colors:
  # Light theme values. Normative source: apps/desktop/src/theme/themes.ts (lightTheme).
  # Keys are the semantic tokens of tokens.ts in kebab case; in CSS each is var(--c-<key>).
  # Dark values and the high-contrast system-colour mapping are in the Colors section.
  app: "#F3F4F6"
  titlebar: "#EBEDF0"
  sidebar: "#EBEDF0"
  sidebar-hover: "#E0E3E7"
  sidebar-selected: "#D5ECE5"
  sidebar-text: "#1B1D21"
  sidebar-muted: "#555B64"
  surface: "#FFFFFF"
  surface-alt: "#F6F7F9"
  raised: "#FFFFFF"
  hover: "#F1F3F5"
  selected: "#E2F2ED"
  selected-border: "#0E7C66"
  selected-text: "#1B1D21"
  input: "#FFFFFF"
  input-border: "#8A919B"
  border: "#E4E7EB"
  border-strong: "#C9CED5"
  text: "#1B1D21"
  text-muted: "#555B64"
  text-subtle: "#646B74"
  text-on-accent: "#FFFFFF"
  link: "#0B6B58"
  accent: "#0E7C66"
  accent-hover: "#0A6653"
  accent-soft: "#DDF1EB"
  focus: "#0E7C66"
  funded-bg: "#C9EFD6"
  funded-fg: "#0B4F2E"
  underfunded-bg: "#FCE6A4"
  underfunded-fg: "#5A3F00"
  overspent-bg: "#FBD1CD"
  overspent-fg: "#8E150E"
  zero-bg: "#ECEEF1"
  zero-fg: "#4C525A"
  bar-track: "#E4E7EB"
  bar-funded: "#24884C"
  bar-funded-spent: "#A6DDB9"
  bar-underfunded: "#A97C00"
  bar-underfunded-spent: "#F1D98E"
  bar-overspent: "#D1342A"
  bar-snoozed: "#858C95"
  rta-positive-bg: "#C9EFD6"
  rta-positive-fg: "#0B4F2E"
  rta-zero-bg: "#E8EAED"
  rta-zero-fg: "#33383F"
  rta-negative-bg: "#FBD1CD"
  rta-negative-fg: "#8E150E"
  negative: "#B42318"
  warn-text: "#855800"
  bad-text: "#B42318"
  chart-1: "#0E7C66"
  chart-2: "#3B6FD8"
  chart-3: "#C76A12"
  chart-4: "#8E5BD1"
  chart-5: "#C2417A"
  chart-6: "#1F8AA3"
  chart-7: "#6B8A12"
  chart-8: "#9A6234"
  chart-income: "#24884C"
  chart-expense: "#D1342A"
  chart-net: "#1B1D21"
  chart-grid: "#E4E7EB"
  flag-red: "#D13438"
  flag-orange: "#E3620C"
  flag-yellow: "#C99A00"
  flag-green: "#13A10E"
  flag-blue: "#0F6CBD"
  flag-purple: "#8764B8"
  shadow: "rgba(15, 23, 42, 0.14)"
  scrim: "rgba(15, 23, 42, 0.32)"
typography:
  display:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  display-stat:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.1
    fontFeature: "tnum"
  headline:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "tnum"
  title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  nav:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.35
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "tnum"
  body-strong:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
    fontFeature: "tnum"
  caption:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.35
  meta:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
  status:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.35
  label-caps:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.04em"
  label-group:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.02em"
rounded:
  sm: "3px"
  md: "4px"
  tab: "6px"
  lg: "8px"
  full: "999px"
spacing:
  "2": "2px"
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-on-accent}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: "0 12px 0 14px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.text-on-accent}"
  button-primary-disabled:
    backgroundColor: "{colors.border-strong}"
    textColor: "{colors.text-muted}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
  button-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.link}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "30px"
  button-toolbar-hover:
    backgroundColor: "{colors.hover}"
  button-toolbar-disabled:
    textColor: "{colors.text-subtle}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    size: "30px"
  button-icon-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "28px"
  chip-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-text}"
  chip-alert:
    backgroundColor: "{colors.overspent-bg}"
    textColor: "{colors.overspent-fg}"
  pill-funded:
    backgroundColor: "{colors.funded-bg}"
    textColor: "{colors.funded-fg}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.full}"
    padding: "0 9px"
    height: "22px"
    width: "84px"
  pill-underfunded:
    backgroundColor: "{colors.underfunded-bg}"
    textColor: "{colors.underfunded-fg}"
    rounded: "{rounded.full}"
    height: "22px"
  pill-overspent:
    backgroundColor: "{colors.overspent-bg}"
    textColor: "{colors.overspent-fg}"
    rounded: "{rounded.full}"
    height: "22px"
  pill-zero:
    backgroundColor: "{colors.zero-bg}"
    textColor: "{colors.zero-fg}"
    rounded: "{rounded.full}"
    height: "22px"
  rta-banner-positive:
    backgroundColor: "{colors.rta-positive-bg}"
    textColor: "{colors.rta-positive-fg}"
    typography: "{typography.display}"
    rounded: "{rounded.lg}"
    padding: "8px 8px 8px 18px"
  rta-banner-zero:
    backgroundColor: "{colors.rta-zero-bg}"
    textColor: "{colors.rta-zero-fg}"
  rta-banner-negative:
    backgroundColor: "{colors.rta-negative-bg}"
    textColor: "{colors.rta-negative-fg}"
  inspector-card:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.nav}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "34px"
  nav-item-current:
    backgroundColor: "{colors.sidebar-selected}"
    textColor: "{colors.sidebar-text}"
  table-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label-caps}"
    padding: "0 14px"
    height: "32px"
  plan-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "0 14px"
    height: "34px"
  plan-row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-text}"
  plan-group-row:
    backgroundColor: "{colors.surface-alt}"
    typography: "{typography.body-strong}"
    height: "36px"
  register-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "0 10px"
    height: "30px"
  input-assigned:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 6px"
    height: "26px"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 6px"
    height: "26px"
  search-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "0 6px 0 10px"
    height: "30px"
    width: "260px"
  tabs-track:
    backgroundColor: "{colors.surface-alt}"
    rounded: "{rounded.lg}"
    padding: "3px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.tab}"
    padding: "0 12px"
    height: "30px"
  tab-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  toast:
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "10px 10px 10px 16px"
  bulk-bar:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px 6px 6px 16px"
---

# Design System: HAFB

## Overview

**Creative North Star: "The Trusted Plan, Native"**

HAFB is the budgeting screen YNAB users already know, rebuilt as a first-class Windows app. The surfaces are calm Fluent neutrals: a soft grey window ground, a white work surface, a slightly darker sidebar. Money sits in clean right-aligned tabular columns at desktop density (34 px plan rows, 30 px register rows). Nothing on screen competes with the numbers.

Colour belongs to the state of each dollar. Green, amber, red and grey Available pills, the segmented progress bars under category names and the Ready to Assign banner carry almost all of the colour on any screen. A single deep teal-green accent marks selection and primary actions. Expenses, debts and loan balances stay neutral: spending money is normal, not an alarm. Every state is also carried by shape and icon, so the plan reads the same in high contrast or with "differentiate without colour" on.

The system rejects the fintech-dashboard default of gradient hero cards, metric tiles and decorative charts on the plan. Depth comes from tonal steps and 1 px hairlines; shadows appear only under things that float. The one piece of signature motion is cause and effect: when money is assigned, the Ready to Assign figure, the category's pill and its bar move together in 180 ms.

**Key Characteristics:**
- Fluent-native: Segoe UI Variable (Text and Display optical sizes), Fluent System Icons (regular weight, 16/20 px), 4 px and 8 px radii, a short pill-shaped selection indicator.
- Dense, tabular, keyboard-first. Tabular numerals everywhere, money right-aligned.
- Colour only for money state. One accent for selection and primary actions.
- Every colour is a semantic token; a theme is data (ADR 0003). Light, dark and high contrast ship.
- Status is never hue alone: icons, outline styles, hatching and chart patterns back it up.
- One motion: a 180 ms ease-out tween that ties cause (assign) to effect (RTA, pill, bar).

## Colors

A quiet neutral field with one teal-green accent and a four-state money palette (green, amber, red, grey) that does the talking.

**How colours work.** `apps/desktop/src/theme/tokens.ts` lists every colour role (70 tokens); `themes.ts` maps each one for Light, Dark and High contrast. `applyTheme()` writes them as `--c-<kebab-token>` custom properties on the root (`accentSoft` → `--c-accent-soft`, `chart1` → `--c-chart-1`) and sets `color-scheme`. Components use only `var(--c-*)`. The frontmatter carries the light values; `themes.ts` is normative for all three themes.

### Primary
- **Ledger Teal** (`accent`; dark `#4FD1B0`; HC `Highlight`): HAFB's own hue. The primary button (Assign, Approve all, Assign $X, Cover $X), checked checkboxes, the selected segment of segmented controls, the approval-banner icon and the Cost to Be Me meter. Never used for money state.
- **Ledger Teal Deep** (`accent-hover`; dark `#6FDCC0`): primary-button hover.
- **Teal Wash** (`accent-soft`; dark `#1F3F37`; HC `Canvas`): text selection, Auto-Assign row hover, the register's approval banner.
- **Teal Ink** (`link`; dark `#6FDCC0`; HC `LinkText`): toolbar commands (Category Group, Undo, Recent Moves, Add Transaction), Auto-Assign option labels, link-style hovers.
- **Selection** (`selected` / `selected-border` / `selected-text`; dark `#1E3D36` / `#4FD1B0` / `#ECEEF1`; HC `Highlight` / `Highlight` / `HighlightText`): selected rows and pressed chips. `selected-border` draws the 3×16 selection pill, a pressed chip's outline and the inline-edit bar.
- **Focus** (`focus`; dark `#6FDCC0`; HC `Highlight`): the focus ring and focused input borders.

### Secondary: money state
The pill, bar and banner families. In each `*-bg`/`*-fg` pair the foreground must reach 4.5:1 on its own background, enforced by test.

| Role | Tokens | Dark | High contrast |
|---|---|---|---|
| Funded (Spring Ledger Green) | `funded-bg` / `funded-fg` | `#1D4A33` / `#B5EECB` | `Canvas` / `CanvasText` |
| Underfunded (Harvest Amber) | `underfunded-bg` / `underfunded-fg` | `#4D3D0E` / `#F7DE8E` | `Canvas` / `CanvasText` |
| Overspent (Signal Coral) | `overspent-bg` / `overspent-fg` | `#5A221E` / `#FFBDB5` | `Mark` / `MarkText` |
| Zero and snoozed (Slate) | `zero-bg` / `zero-fg` | `#33363B` / `#C3C8CF` | `Canvas` / `CanvasText` |
| RTA positive | `rta-positive-bg` / `-fg` | `#1D4A33` / `#B5EECB` | `Canvas` / `CanvasText` |
| RTA zero ("All Money Assigned") | `rta-zero-bg` / `-fg` | `#33363B` / `#DADDE1` | `Canvas` / `CanvasText` |
| RTA negative | `rta-negative-bg` / `-fg` | `#5A221E` / `#FFBDB5` | `Mark` / `MarkText` |

**Progress bars.** The dark shade is money held, the light shade is the part already spent, and the track is empty.

| Token | Dark | HC |
|---|---|---|
| `bar-track` | `#3A3D43` | `Canvas` |
| `bar-funded` / `bar-funded-spent` | `#43B873` / `#2C6B47` | `CanvasText` / `GrayText` |
| `bar-underfunded` / `bar-underfunded-spent` | `#E5B931` / `#7A6420` | `CanvasText` / `GrayText` |
| `bar-overspent` | `#F0675A` | `Mark` |
| `bar-snoozed` | `#7E858E` | `GrayText` |

**Status text on ordinary surfaces.** `negative` (dark `#FF9A8F`) is negative money in tables. `warn-text` (dark `#F2CF6B`) is the underfunded target message. `bad-text` (dark `#FF9A8F`) is the overspent message. All three map to `CanvasText` in HC. Never draw a pill's `*-fg` off its own `*-bg`; use these.

### Tertiary: charts and flags
- **Series** `chart-1`…`chart-8` (light in the frontmatter; dark `#4FD1B0 #7EA6F7 #F0A35E #B896F2 #EE85B1 #5CC4DB #A9CB4F #D6A47A`). Categorical, cycled in order, each at least 3:1 on `surface`. In HC they map to `CanvasText / Highlight / LinkText / GrayText / Mark / CanvasText / Highlight / LinkText`, and patterns separate them.
- **Semantic series**:
  - `chart-income` (dark `#43B873`): assets and income.
  - `chart-net` (dark `#ECEEF1`): the net-worth line and its points.
  - `chart-expense` (dark `#F0675A`): defined and contrast-tested, but no shipped chart uses it. Net Worth debts draw in `chart-2`.
  - `chart-grid` (dark `#363A40`): gridlines.
- **Flags** `flag-red/orange/yellow/green/blue/purple`: YNAB's six transaction flags, user-chosen labels, not state. Dark: `#FF6B6E #FF8C3A #F2CC4B #4CC94A #5AA9F0 #B39DDB`. All map to `CanvasText` in HC.

### Neutral
- **Window Mist** (`app`; dark `#1B1C1F`; HC `Canvas`): the window ground and the inspector column.
- **Sidebar Fog** (`sidebar`, `titlebar`; dark `#202124`): sidebar and title bar. Hover is `sidebar-hover`; the current item is `sidebar-selected`, a pale teal (dark `#21403A`, HC `Highlight`). `sidebar-text` and `sidebar-muted` are the sidebar's text pair.
- **Paper** (`surface`; dark `#25272B`): the plan grid, register, report bodies, table headers.
- **Paper Shade** (`surface-alt`; dark `#2B2E33`): category-group rows, the scheduled-section header, subtotal rows, the tab track and the Working Balance tile.
- **Raised** (`raised`; dark `#2E3136`): inspector cards, the bulk-action bar, menus and popovers.
- **Row Hover** (`hover`; dark `#2F3237`): row, chip and button hover.
- **Ink** (`text`; dark `#ECEEF1`), **Ink Muted** (`text-muted`; dark `#B3B9C1`), **Ink Subtle** (`text-subtle`; dark `#A0A7B0`): primary text; labels and column headers; meta, placeholders and disabled. All three map to `CanvasText` in HC.
- **Hairline** (`border`; dark `#363A40`) and **Hairline Strong** (`border-strong`; dark `#4A4F57`): row dividers, panel edges, chip outlines, header underlines. Both are `CanvasText` in HC.
- **Field** (`input` / `input-border`; dark `#1E2024` / `#7D848D`; HC `Field` / `FieldText`): form fields. `input-border` passes 3:1 against `input`.
- **Depth** (`shadow`; dark `rgba(0,0,0,0.5)`; HC `transparent`) and **Scrim** (`scrim`; dark `rgba(0,0,0,0.55)`; HC `Canvas`).

### Named Rules
**The Money-State Colour Rule.** Hue on the plan means the state of money: funded, underfunded, overspent, empty or snoozed. The accent means selection or "do this". Nothing else gets colour.

**The Red Means Act Rule.** Red (`overspent-*`, `bar-overspent`, `negative`, `bad-text`, `rta-negative-*`) is reserved for four things:
- an overspent category;
- a negative Ready to Assign;
- an overdrawn cash account or cash group total;
- a negative Net Income.

It also colours the text of the destructive Delete command. Red never marks an ordinary expense.

**The Neutral Debt Rule.** Outflows, Activity, credit-card balances, loan balances and debts render in plain `text`. Sidebar Credit and Loans totals stay neutral even though they're negative. Net Worth draws debts in `chart-2`, not red.

**The Token-Only Rule.** A raw colour in component CSS or TSX is a bug. Every colour comes from `var(--c-<token>)`. Hatching and chart patterns are built from tokens too.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI, system-ui)
**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui)
**Label/Mono Font:** none. Labels use the Text face; `kbd` hints use the Text face at 11px.

**Character:** Windows' own face, used at its two optical sizes. Display is for the few figures and titles a person looks for first; Text is everything else. It is deliberately the platform font (PRODUCT.md: Fluent-native), because a native app should look like it belongs on the OS.

CSS custom properties: `--font-display`, `--font-ui`. The root `.hd` sets `400 13px/1.35 var(--font-ui)` and `font-variant-numeric: tabular-nums`.

### Hierarchy
- **Display** (650, 22px, 1.1, -0.01em, Display face): the Ready to Assign figure. The same 650/22 is used for Reflect report headline figures and the donut centre.
- **Display Stat** (650, 24px, 1.1, Display face): the single big figure in an inspector card (Cost to Be Me).
- **Headline** (600, 20px, 1.2, -0.01em, Display face): screen titles: the month ("Oct 2026"), the account name in a register, "Reflect".
- **Figure** (600, 16px, 1.2, Display face): register header balances (Cleared, Uncleared, Working). Reflect ranked-list totals use 650/16.
- **Title** (600, 14px, 1.3, Text face): inspector card headings and the plan-menu name.
  - Neighbours: Reflect ranked-list heading 600/15; empty-state heading 600/16.
- **Nav** (400, 13.5px): sidebar Plan / Reflect / All Accounts; 600 when current.
- **Body** (400, 13px, 1.35): every table cell, inspector line and button label.
  - Body Strong (600): group rows, totals, unapproved register rows, pill amounts, primary-button labels, pressed chips.
  - Medium (500): toolbar commands, secondary buttons, Auto-Assign labels and tabs.
- **Caption** (400, 12.5px): chip labels, inspector notes, chart legends, register subtitle, split sub-rows, percentages.
- **Meta** (400, 12px): RTA label (600), month-note line, Age of Money label, "N selected", account-type subtitles, chart axes.
- **Status** (400, 11.5px): the right-aligned target message on a category row ("$64.06 more needed by the 20th", "Overspent $86.21 on credit", "Funded", "Fully spent"); also "Reconciled N days ago".
- **Label Caps** (600, 11.5px, 0.04em, uppercase): column headers in the plan grid, register and Reflect tables, in `text-muted`.
- **Label Group** (600, 12px, 0.02em, uppercase): sidebar account-group heads (Starred, Cash, Credit, Loans, Tracking), in `sidebar-muted`, with the group total in sentence case.

### Named Rules
**The Tabular Rule.** Every number that is money, a date or a count is set in tabular numerals and right-aligned in its column (`.num`: right, `tabular-nums`, `nowrap`). Charts' axis labels too. Proportional figures never appear next to money.

**The Two Optical Sizes Rule.** The Display face is only for money figures and screen titles, at 16px and up. Everything else uses the Text face, including card, section and empty-state headings (14–16px).

## Layout

**Shell.** A full-window CSS grid: sidebar (`--sidebar-w`, 252px) | main. Main is a second grid: work surface (`minmax(0,1fr)`) | inspector (`--inspector-w`, 328px). Register and Reflect use the full-width variant with no inspector. The custom title bar is 32px tall with 46px caption buttons (fixed by `TITLEBAR_HEIGHT` in `src-tauri/src/lib.rs`). It shows the "HAFB" name at 12px in `titlebar` and supports Snap Layouts; the native title bar is the fallback.

**Responsive.** At window widths of 1365px and below:
- the sidebar narrows to 232px and the inspector to 296px;
- plan money columns shrink from 140px to 112px;
- grid cell padding drops from 14px to 10px;
- the pill min-width drops from 84px to 76px.

Category names get the room. At 1100px and below, Reflect's Spending Breakdown stacks the donut above the ranked list. Display scaling of 100–200% must hold (PRODUCT.md).

**Sidebar** (top to bottom):
1. Plan menu: a 32px app mark, the plan name in Title and "local file" meta, and a chevron.
2. Navigation: Plan, Reflect, All Accounts. 34px items with 20px icons, 2px gaps.
3. A hairline, then the scrolling account list.
   - Groups in order: **Starred** (only if any), **Cash**, **Credit**, **Loans**, **Tracking**. Closed accounts are hidden.
   - Each group has a 30px collapsible head (Label Group, chevron, and the group total, except for Starred).
   - Account rows are 30px, indented 24px: name with ellipsis, right-aligned balance. The current account uses `sidebar-selected` and weight 600.
4. Footer: Display options (mockup-only today) and a 32px outlined **Add Account** button.

**Plan screen** (work column, top to bottom):
1. **Header**: a `1fr auto 1fr` grid, padding 14/20/12.
   - Left: previous/next 30px icon buttons around the month Headline, with the month-note line under it.
   - Centre: the Ready to Assign banner with its Assign button.
   - Right, end-aligned: Hide amounts and plan options, as 20px icon buttons.
2. **Focused View chips**: wrapping, 6px gap, padding 0 20px 10px. The "N Overspent" alert chip comes first when anything is overspent, then All, Underfunded, Overfunded, Money Available, Snoozed.
3. **Toolbar**: 40px, hairlines above and below. Toolbar buttons: Category Group, Undo, Redo, Recent Moves; a spacer; "N selected" in Meta.
4. **Plan grid**: a fixed-layout table that scrolls on its own, with a sticky 32px header and a `border-strong` underline.
   - Columns: checkbox (40px) | Category (fluid) | Assigned (140px) | Activity (140px) | Available (140px).
   - Group rows are 36px on `surface-alt`, weight 600, with a 22px collapse chevron and group totals. Only a negative group Available turns red.
   - Category rows are 34px, hairline-separated. The cell is a two-row grid: the name (ellipsis) and the right-aligned Status message on the first row, the progress bar spanning the second (3px row gap).

**Inspector**: on `app`, padded 14/14/24, with a left hairline. A stack of cards with 12px between them.
- No selection: Month Summary (left over, assigned, activity, then an Available total), Auto-Assign, Cost to Be Me.
- One category: the category card (Available pill, then cash left over, assigned, cash spending, credit spending, Available total, and a coaching note when overspent), the Target card, Auto-Assign scoped to that category, Notes.
- Several categories: a selection-totals card, then Auto-Assign scoped to the selection.

**Register** (full width):
1. **Header**: wrapping flex, padding 16/20/14.
   - Title block: the account Headline, then type · on-budget/tracking · note in Caption.
   - The **balance equation**: `Cleared Balance + Uncleared Balance = Working Balance`, as three Figures with Meta labels. Cleared carries a checkmark-circle icon in `bar-funded`, Uncleared an empty circle. The `+` and `=` are 18px weight-300 `text-subtle` operators, hidden from screen readers. Working Balance sits in an 8px-radius `surface-alt` tile.
   - Then Reconcile (secondary button with a lock icon) over "Reconciled N days ago".
2. **Toolbar**: Add Transaction, File Import, Record Payment (credit cards only); a spacer; a 30px date-range chip; a 260px search field with a `Ctrl+F` key hint.
3. **Approval banner**, when anything is unapproved.
4. **Grid** at 30px rows. Columns: checkbox | flag (34px) | Account (148px, All Accounts only) | Date (98px) | Payee (188px) | Category (160px) | Memo (fluid) | Outflow (104px) | Inflow (104px) | cleared (44px).
   - A collapsible **Scheduled** section header sits first, on `surface-alt`.
   - Split children are 26px rows with dashed dividers at Caption size, with the category and memo indented 26px.
   - Unapproved rows are weight 600, with a 6px accent dot before the payee.
   - Transfers carry an arrow-swap icon.

**Reflect** (full width):
1. **Header**: the "Reflect" Headline beside a segmented tab list: Spending Breakdown, Spending Trends, Net Worth, Income v Expense, Age of Money.
2. **Filter row** of chips: date range, All Categories, All Accounts. It ends in a hairline.
3. **Body**: padding 20/24/96, report max-width 1100px.
   - Report head: Display figures with Caption labels and a ≤46ch explanation.
   - Charts sit in an 8px-radius bordered box, 838px max.
   - Tables under charts share the 820px measure.
   - Breakdown is a donut (340px max) beside a ranked list (34px rows, 48px gap).
   - Income v Expense is a sticky-first-column table at 30px rows with section, group, subtotal and a 2px-ruled Net Income row.

**Spacing rhythm.** A 2px base with real steps of 2, 4, 6, 8, 10, 12, 14, 16, 20 and 24.
- Horizontal gutters: 20px on headers, 14px on toolbars and grid cells (10px when narrow), 24px on Reflect.
- Controls sit 2–8px apart. Cards are 12px apart.

## Elevation & Depth

Flat and tonal. Depth comes from three neutral steps (`app` < `surface`/`raised`, with `sidebar` slightly darker than `app`), `surface-alt` bands for grouping, and 1px hairlines (`border`, `border-strong`). Nothing that sits in the layout casts a shadow. Shadows appear only on elements that float above content and could cover it. In high contrast `shadow` is `transparent`, so floating layers rely on their `border-strong` outline.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px var(--c-shadow)`): toasts, the register's bulk-action bar, chart tooltips, the display-options popover. Menus, popovers and dialogs (S3.2) inherit this.
- **Lift** (`box-shadow: 0 1px 3px var(--c-shadow)`): the selected tab inside the Reflect tab track, so it reads as raised from the track. In HC, a 2px `selected-border` outline replaces it.

### Named Rules
**The Float-Only Shadow Rule.** A shadow means "this is above the page and will go away". Cards, the inspector, banners, pills and rows are flat; they separate by tone and hairline.

## Shapes

Gently squared Fluent geometry.
- **4px** (`--radius`): the default for buttons, inputs, icon buttons, nav items, sidebar rows and the focus ring.
- **8px** (`--radius-lg`): containers. Inspector cards, the RTA banner, the approval banner, chart boxes, report tables, the toast, the bulk bar, the plan-menu button and the app mark.
- **6px**: tabs inside their track.
- **3px**: checkboxes, progress-bar segments, `kbd` hints and legend keys.
- **Fully round (999px)**: Available pills, Focused View and filter chips, segmented controls.

Borders are 1px hairlines; 1.5–2px appears only as a state signal (no-colour pill outlines, the net-income rule, the focus ring).

**The selection indicator** is Fluent's short pill: a 3×16px, 2px-radius bar in `selected-border`, vertically centred 3px inside the row's first cell. It is never a full-height stripe on a selected row. The full-height 3px inset bar is reserved for the row in inline edit (`box-shadow: inset 3px 0 0 var(--c-selected-border)`).

**Progress bars** are 5px tall, made of 3px-radius segments with 2px gaps. The inspector's Cost to Be Me meter is 8px tall with a 4px radius.

## Components

The production component library lives in `apps/desktop/src/ui/` (S3.2, ADR 0004), with a dev gallery at `#/gallery` that shows every component in every state and theme.
- **Library:**
  - Buttons and icon buttons (with tooltips and shortcut chips).
  - Text, text area, money (math with exact results) and date (keys plus a calendar) inputs.
  - Checkbox, toggle, segmented control, chips.
  - Grouped searchable combobox with payee and category pickers.
  - Menus and context menus, dialog with `useConfirm`, tooltips, toasts with Undo.
  - Available pill, segmented progress bar, progress ring, Ready to Assign banner, notices.
- **Values:** they come only from theme tokens: colour `--c-*`, type `--t-*`, shape `--s-*`, density `--d-*`, motion `--m-*`. `src/theme/sourceScan.test.ts` enforces this.
- **Approved look:** the defaults reproduce the S3.1 look below exactly.
- **Disabled primary buttons:** use the `disabled-bg`, `disabled-fg` and `disabled-border` tokens. Light and dark keep the approved values; high contrast gets GrayText on Canvas with a border.

### Buttons
Quiet and Fluent: all buttons are flat, and only the primary button is filled.
- **Primary** (`button-primary`): an `accent` fill with `text-on-accent` text, weight 600, 32px tall, 4px radius, optionally with a trailing chevron (Assign ▾).
  - Hover: `accent-hover`. Disabled: a `border-strong` fill with `text-muted` text, e.g. Assign when RTA ≤ 0.
  - One per region: the RTA banner, the inspector Target card (Assign $X / Cover $X / Fully funded), the approval banner (Approve all), the edit row.
  - Inside banners it drops to 30px.
- **Secondary** (`button-secondary`): `surface` with a 1px `border-strong` outline, weight 500, 32px; hover `hover`. Used for Edit Target, Create Target, Reconcile and Review.
- **Toolbar** (`button-toolbar`): transparent, `link`-coloured, weight 500, 30px, with a 16px icon and a label.
  - Hover: `hover`. Disabled: `text-subtle` at 0.6 opacity.
  - Destructive variant: Delete in the bulk bar uses `negative` text.
- **Icon** (`button-icon`): a 30×30 transparent square in `text-muted`. Hover: `hover` background and `text` colour. Disabled: 0.4 opacity.
  - Header icons are 20px; inline icons are 16px.
  - Every icon-only button has an `aria-label`.
- **Auto-Assign row**: a full-bleed 32px hairline row (bleeding 8px past the card padding). The label is in `link` at weight 500; the live amount is right-aligned in `text` at weight 400.
  - Hover: `accent-soft`. Disabled (no change): both label and amount go `text-subtle`.
  - Groups (Underfunded | last-month and averages | reduce and reset) are separated by a 1px `border` rule with 6px margins.
  - The reset options appear only when a selection exists.

### Chips
- **Style** (`chip`): 28px, full radius, 1px `border-strong` outline, `surface` fill, Caption size, an optional leading 16px icon; hover `hover`.
- **Pressed** (`chip-selected`, `aria-pressed="true"`): `selected` fill, `selected-border` outline, `selected-text`, weight 600.
- **Alert** (`chip-alert`): "N Overspent". No outline; `overspent-bg`/`overspent-fg`, weight 600, warning icon. It appears first, only when something is overspent.
- **Menu chips** (register date range, Reflect filters): the same shape with a trailing chevron and `aria-haspopup="menu"`. In the register toolbar they are 30px.

### Available pill (signature)
The state of each category's money. Right-aligned in the Available column, 22px tall, minimum 84px wide (76px when narrow), 9px side padding, weight 600, tabular numerals.

| State | When | Colours | Icon (always) | Icon + shape (no-colour / HC) |
|---|---|---|---|---|
| Funded | available > 0, target met or no target | `funded-*` | none | checkmark |
| Underfunded | target needs more this month | `underfunded-*` | none | clock, 1.5px dashed outline |
| Overspent | available < 0 | `overspent-*` | **card** icon if the overspending is on credit | warning, 2px solid outline |
| Zero | available = 0 | `zero-*`, weight 500 | none | none (neutral pill) |
| Snoozed | target snoozed this month | `zero-*`, weight 500 | none | snooze |

- A visually hidden prefix ("funded: ", "underfunded: ", "overspent: ", "empty: ", "snoozed: ") gives screen readers the state. The pill's `title` repeats the status message.
- Colour changes transition over 180ms. In HC every pill gets a 1px `currentColor` outline.
- The same pill appears in the inspector's category card.

### Segmented progress bar
Sits under the category name whenever there is a target (or the category is overspent).
- **Shape**: 5px tall, 3px-radius segments with 2px gaps, on a `bar-track` track.
- **Segments**: one per week for weekly targets (needed ÷ weekly amount); otherwise one.
- **Layers**: each segment stacks a **fill** (money held toward the target, the dark shade) and a **spent** layer (the part already spent, the light shade). Both are drawn with `transform: scaleX()` from the left edge, so updates animate on the compositor.
- **States**:
  - **Funded**: `bar-funded` with `bar-funded-spent`. A funded target that has been fully spent stays funded-coloured, with an all-light bar.
  - **Underfunded**: `bar-underfunded` with `bar-underfunded-spent`.
  - **Overspent**: a full-width `bar-overspent`.
  - **Snoozed**: `bar-snoozed`.
- **No colour**: the underfunded fill becomes 135° hatching (3px on, 2px off) and the overspent fill becomes vertical dashes (4px on, 2px off).
- **HC**: each segment gets a 1px `border` outline.
- **Accessibility**: the bar is `aria-hidden`; the status text and the pill carry the meaning.

### Ready to Assign banner
Top-centre of the plan header, on an 8px-radius tonal block.
- **Content**: the RTA figure in Display, a 12px/600 label, and the primary **Assign ▾** button 16px to the right.
- **States**:
  - **Positive**: `rta-positive-*`, labelled "Ready to Assign".
  - **Zero**: `rta-zero-*`, labelled "All Money Assigned". Assign is disabled.
  - **Negative**: `rta-negative-*`, labelled "You assigned more than you have". Assign is disabled.
- **Motion**: the background and text colours transition over 180ms.
- **Accessibility**: the banner is `role="status"` with `aria-live="polite"`.

### Cards / Containers
- **Corner Style**: 8px.
- **Background**: `raised` (inspector) or `surface` (report chart boxes and tables), sitting on `app` or `surface`.
- **Shadow Strategy**: none (see Elevation), except tooltips, which float.
- **Border**: 1px `border`.
- **Internal Padding**: 14px 16px for inspector cards; 12px 8px 4px for chart boxes.
- **Inspector card anatomy**:
  - The heading is in Title, with an optional 16px `text-muted` icon (target, note).
  - Lines (`hd-line`) are label (`text-muted`) and value (tabular) pairs, 4px vertical padding.
  - A **total** line follows a hairline, with 8px above it, at weight 600 with the label in `text`.
  - Big figures are Display Stat.
  - Notes are Caption in `text-muted`.
  - The action row has an 8px gap, 12px above.
- **Approval banner** (register): an 8px radius, a `selected-border` outline, an `accent-soft` fill, a 20px info icon in `accent`, `text` copy, then Review (secondary) and Approve all (primary).
- **Empty state** (Reflect): an 8px radius with a 1px dashed `border-strong` outline, centred, 460px max, a 32px pad, an `accent` icon, a 16px/600 heading and a muted line.

### Inputs / Fields
- **Assigned cell** (`input-assigned`): reads as plain right-aligned text until the row is hovered; then it shows a 1px `input-border` and an `input` fill.
  - On focus it shows a 1px `focus` border plus a 1px `focus` outline, and selects its contents.
  - Enter commits, Esc cancels. An unparseable entry raises a toast; it's never swallowed.
- **Field** (`input-field`, register inline edit): 26px, `input` fill, a 1px `input-border`, 4px radius. Focus is the same as the assigned cell.
  - Disabled fields get a dashed border and `text-subtle`.
  - Money fields are right-aligned.
  - The edit row is 36px on `selected`, followed by a 42px actions row.
- **Search** (`search-field`): 30px, 260px wide, a leading search icon, placeholder in `text-subtle`, and a trailing `kbd` hint (11px, 3px radius, `border-strong`). On focus-within: a `focus` border plus `0 0 0 1px var(--c-focus)`.
- **Checkbox**: a custom 16px box with a 3px radius and an `input-border` outline. When checked it fills with `accent` and draws a `text-on-accent` tick.
- **Textarea** (notes): at least 64px, 8px padding, the field styling above, vertical resize.

### Navigation
- **Sidebar items** (`nav-item`): 34px, 4px radius, 20px icon, 10px gap, Nav size. Hover: `sidebar-hover`. Current (`aria-current="page"`): `sidebar-selected` and weight 600.
- **Account rows**: 30px, with the same hover and current treatment.
- **Group heads**: Label Group, collapsible (`aria-expanded`).
- **Reflect tabs**: a segmented track (`surface-alt`, 1px `border`, 8px radius, 3px pad) of 30px tabs with 6px radii. Inactive tabs are `text-muted` at weight 500. The selected tab has a `surface` fill, `text`, weight 600 and the Lift shadow.
  - Semantics: `role="tablist"`, `role="tab"` with `aria-selected`, and `aria-controls` pointing at a single `tabpanel`.

### Register row
- **Size**: 30px at Body size, with 10px cell padding.
- **Hover**: `hover`.
- **Selected**: `selected` with `selected-text`, plus the 3×16 selection pill.
- **Flag cell**: a 26px button. It's invisible until the row is hovered, focused or flagged; then it shows in the flag's colour.
- **Cleared cell**: a 26px button showing an empty circle (uncleared), a checkmark circle in `bar-funded` (cleared), or a lock in `text-muted` (reconciled, not toggleable).
- **Bulk-action bar**: floats bottom-centre (20px up), on `raised` with a `border-strong` outline, 8px radius and the Float shadow. It holds the count, link-coloured select menus, Delete (in `negative`) and a dismiss icon button. It's `role="toolbar"` and slides in over 180ms.

### Toast
An inverted capsule, bottom-centre, 18px up.
- **Look**: `text` background with `surface` text, 8px radius, the Float shadow, 14px gap.
- **Action**: an optional text action (e.g. Redo after an undo), weight 600, underlined with a 3px offset.
- **Timing**: it enters by fading and rising 8px over 180ms, then auto-dismisses after 5s.
- **Semantics**: `role="status"`.

### Charts (Reflect)
- **Fills**: series fills come from `--s-fill-1…8`, which resolve to `chart-1…8`. With no-colour or HC on, they switch to `url(#rf-pat-N)` patterns, rendered once per screen.
  - Pattern 1 is a solid fill.
  - Patterns 2–8 are a 28% tint of the series colour overlaid with a distinct mark: diagonal, dots, horizontal, vertical, cross-hatch, back-diagonal, squares.
  - Legend swatches (12px, 3px radius) use the same fill, so they always match.
- **Strokes**:
  - Gridlines: `chart-grid` at 1px.
  - The zero line: `border-strong` at 1.5px.
  - Lines (net worth, Age of Money): 2.5px with round joins and hollow `surface`-filled points.
  - The average: a 1.5px `text` dash (5 4).
  - Donut slices are separated by a 2px `surface` stroke.
- **Axes**: 12px `text-muted` tabular.
- **Hover**: non-hovered series dim to 0.35 opacity (120ms), and the tooltip is a floating inspector card.
- **Accessibility**: every chart is `role="img"` with an `aria-label` that lists its data.

### Motion
- **Tokens**:
  - `--t-fast`: 120ms, for chart dimming.
  - `--t-move`: 180ms, for state colour, bars, banner and entrances.
  - `--ease`: `cubic-bezier(0.16, 1, 0.3, 1)`, an ease-out with a soft landing.
- **The signature**: a change to assigned money tweens the RTA figure and the category pill's amount from old to new over 180ms, with a cubic ease-out, rounded to whole minor units each frame. The bar's `scaleX` and the pill and banner colours transition on the same 180ms curve, so cause and effect land together.
  - A 220ms timeout always settles on the true value, because frames don't run in hidden or minimised windows.
- **Reduced motion**: with `prefers-reduced-motion: reduce`, the tween is skipped and all transitions and animations under `.hd` are disabled.

## Do's and Don'ts

### Do:
- **Do** take every colour from a semantic token (`var(--c-*)`), and add a token to `tokens.ts` plus all three themes before using a new role.
- **Do** add a theme as data. Write a `Theme` object (`id`, `name`, `scheme`, optional `system`, and every `ColorToken`) and list it in `BUILT_IN_THEMES`.
  - It must pass `theme.test.ts`: 4.5:1 for every text pair the UI draws, and 3:1 for state graphics, focus, input borders and chart series.
  - A theme that fails is not shipped.
- **Do** add any new foreground/background pairing to `TEXT_PAIRS` or `GRAPHIC_PAIRS` in `theme.test.ts` in the same change.
- **Do** back every colour-coded state with an icon or shape (checkmark, clock, warning, snooze, card; dashed or solid outlines; hatching; chart patterns).
  - "Differentiate without colour" is a user option. High contrast forces it on.
- **Do** keep plan rows at 34px, register rows at 30px, group rows at 36px and table headers at 32px, with tabular, right-aligned money.
- **Do** use the 3×16px selection pill for selected rows, the 2px `focus` ring (offset -2px, 4px radius) for keyboard focus, and `aria-selected` with `aria-multiselectable` on selectable grids.
- **Do** use Fluent System Icons, regular weight only, at 16px inline and 20px for navigation and header actions, imported individually through `ui/Icon.tsx`.
- **Do** animate money changes with the one 180ms ease-out (`--t-move`, `--ease`), using `transform` for bars, and honour reduced motion.
- **Do** put a visually hidden state word in any element whose meaning is otherwise carried by colour.
- **Do** use YNAB's words on screen: Plan, Ready to Assign, Assigned, Activity, Available, Targets, Reflect, Inspector.

### Don't:
- **Don't** use a raw hex, rgb or named colour outside `apps/desktop/src/theme/`.
- **Don't** colour expenses, outflows, credit-card balances, loans or debts red. Red is for overspent categories, a negative Ready to Assign, overdrawn cash and a negative Net Income (and the Delete command's text).
- **Don't** use the accent for money state, or a money-state colour for selection or actions.
- **Don't** draw a pill's `*-fg` colour on an ordinary surface. Use `warn-text`, `bad-text` or `negative`, which are tested against rows, hover and selection.
- **Don't** add decorative gradients, glass or hero metric cards. The only gradients in the system are the no-colour hatching patterns on progress bars.
- **Don't** put plan or register rows inside cards. Bordered 8px containers belong to the inspector, report charts and tables, banners and floating bars.
- **Don't** give in-flow elements shadows. Shadows are only for floating layers (Float, Lift).
- **Don't** draw a full-height stripe to mark selection. The full-height 3px inset bar is only for the row in inline edit.
- **Don't** mix icon families or weights, or substitute text glyphs for icons. The `+`/`=` in the register balance equation are mathematical operators, hidden from screen readers.
- **Don't** add a second animation style or a longer duration for routine state changes.
- **Don't** borrow YNAB's name, logo, purple branding or artwork.

## Open items
- **App mark.** The "HAFB" lettering in a 32px accent square is a placeholder. No logo exists yet (PRODUCT.md), and it is not a brand rule.
- **Production components.** These are built (S3.2) in `src/ui/`. The `#/design` mockups still use their own S3.1 CSS, now on the same tokens. Phase 4 rebuilt the real screens from the library (`src/screens`); the mockups stay as the look reference.
- **Raw-value scan.** In place since S3.2 (`sourceScan.test.ts`). It forbids raw colours, font families, radii and rule styles everywhere in `src/ui` and `src/design`, plus literal sizes and durations in `src/ui`.
- **Date keys.** The keys are Quicken-style: + and − for a day; T for today; M / Shift+M and Y / Shift+Y for the start and end of the month and year; PageUp and PageDown for a month (`packages/shared/src/dateInput.ts`, `docs/shortcuts.md`). Weeks start on Sunday.
- **Title bar.** Shipped with the production shell in S3.3: a 32px custom title bar with Snap Layouts, and the native title bar as a tested fallback.
- **Mockup-only controls.** Display options, the theme segmented control and the "Sample data" labels are review scaffolding for the `#/design` mockups, not shipped settings UI. The real settings shipped in S7.1 (Preferences and Plan Settings).
- **Accent hue.** Approved with the look (S7.7 sign-off). Changing it means editing the token values only.
