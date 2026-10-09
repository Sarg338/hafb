# Accessibility audit: WCAG 2.2 AA (S7.4)

**Date:** 2026-10-09. **Build:** the release app (WebView2) and the browser preview. **Result:** no open AA issues.

## How it was checked

- **Automated, axe-core 4.10.3**, with every WCAG 2.0, 2.1 and 2.2 A/AA rule (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`):
  - Run in the light, dark and high-contrast themes.
  - Coverage: the Plan, a category's inspector, All Accounts, a card register, a loan, all five Reflect tabs, and every dialog. Also each open state: plan menu, Ready to Assign breakdown, Assign menu, Assigned cell editing, target editor, move-money popover, register new row, date picker, category picker, row context menu, View options, search, Reconcile, Loan Payoff Simulator, Reflect date range, filters, drill-down and Share Your Progress.
  - A release-app smoke test (`pnpm smoke`, "WCAG 2.2 AA") reruns it on the Plan, register (also while editing), Reflect, Plan Settings, Preferences and New Plan in all three themes, and fails on any violation.
  - The first run found:
    - small targets (the month note, template and payee checklists, Manage Payees' collapse button);
    - a faded `?`-overlay key at 2.67:1;
    - an unfocusable scrolling list;
    - controls directly inside a grid row (the register's editing panel).

    All are fixed.
- **Screen readers.** Narrator reads Windows UI Automation, so the release app's UIA tree was walked on the Plan, a register, Reflect and Plan Settings:
  - The grids appear as DataGrid with DataItems; buttons, check boxes, combo boxes, tabs and radio buttons are all present.
  - No interactive control on screen lacks a name. The only nameless items are empty grid cells (a blank memo, the checkbox column of a group row), which a screen reader announces as blank.
  - NVDA isn't installed on the test PC, so it hasn't been run.
- **Keyboard only.** Release-app smoke tests do the following without the mouse:
  - enter a month of transactions;
  - cover overspending;
  - open the plan menu, change Plan Settings and apply;
  - go to Reflect (G then R) and move between report tabs with the arrow keys.

  Every published YNAB shortcut is registered and tested (S7.3).
- **Windows contrast themes.**
  - Forced colors were emulated, and the app follows Windows' colours (ADR 0003).
  - Filled elements (primary buttons, the HAFB mark, overspent pills and chip, a negative Ready to Assign) were losing their text to the forced-colors override. They now keep the theme's Highlight/HighlightText and Mark/MarkText pairs.
- **Large text and reflow.**
  - Text size goes to 200% (Preferences, Ctrl+=).
  - At 200% in a 1280×720 window (640×360 CSS px) there's no horizontal page scroll: the sidebar becomes its rail below 1024 px, and below 900 px the inspector opens over the plan from Display options.
  - The budget and register grids are data tables, which 1.4.10 exempts; they scroll inside themselves.
- **Text spacing.** The 1.4.12 values (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em) clip no text on the Plan or a register.
- **Focus not obscured.** Arrowing through 40 register rows down and back up, the focused cell never went under the sticky header (0 px).

## Criteria

| Criterion | Status | Evidence |
|---|---|---|
| 1.1.1 Non-text content | Pass | Icon buttons have labels; pill state icons carry screen-reader text; Reflect charts have the same figures as text or tables; decorative icons are `aria-hidden`. |
| 1.2.x Time-based media | N/A | No audio or video. |
| 1.3.1 Info and relationships | Pass | Landmarks (navigation, main, complementary), headings, ARIA grid/treegrid with row and column indexes, labelled fields and groups; axe clean. |
| 1.3.2 Meaningful sequence | Pass | DOM order follows the visual order. |
| 1.3.3 Sensory characteristics | Pass | Instructions name controls, not shapes or positions. |
| 1.3.4 Orientation | Pass | No orientation lock. |
| 1.3.5 Identify input purpose | N/A | No fields collect personal data about the user. |
| 1.4.1 Use of color | Pass | States carry icons and text as well as colour; "Differentiate without color" adds shape cues (Display Options). |
| 1.4.2 Audio control | N/A | No audio. |
| 1.4.3 Contrast (minimum) | Pass | Theme contrast tests (`src/theme/contrast.ts`, `validate.ts`) for every text/background pair in every theme; axe clean in light, dark and high contrast. |
| 1.4.4 Resize text | Pass | Text size 90–200% in Preferences and Ctrl+= / Ctrl+- / Ctrl+0, zooming the whole window. |
| 1.4.5 Images of text | Pass | None. The Share Your Progress image is a user-made export. |
| 1.4.10 Reflow | Pass | 640×360 CSS px without horizontal page scroll; data grids exempt. |
| 1.4.11 Non-text contrast | Pass | Borders, focus ring and control outlines meet 3:1 (theme validation); forced colors use system colours. |
| 1.4.12 Text spacing | Pass | No clipped text with the 1.4.12 overrides. |
| 1.4.13 Content on hover or focus | Pass | Tooltips appear on hover and focus, stay while hovered, and hide on Escape without taking focus. |
| 2.1.1 Keyboard | Pass | Keyboard-only smoke tests; every function has a keyboard path (menus have keyboard openers; grids are fully navigable). |
| 2.1.2 No keyboard trap | Pass | Dialogs contain focus by design and close on Escape; Tab leaves the grids. |
| 2.1.4 Character key shortcuts | Pass | Single-key shortcuts (A, K, S, E, M, C…) can be turned off in Preferences; they never fire while typing in a field. |
| 2.2.1 Timing adjustable | Pass | No time limits. A toast's Undo times out, but Undo stays on Ctrl+Z and the toolbar. |
| 2.2.2 Pause, stop, hide | Pass | No moving or auto-updating content beyond short transitions; reduced motion is honoured. |
| 2.3.1 Three flashes | Pass | Nothing flashes. |
| 2.4.1 Bypass blocks | Pass | "Skip to main content" link. |
| 2.4.2 Page titled | Pass | The window title names the plan. |
| 2.4.3 Focus order | Pass | Focus follows the layout; moving between screens puts focus at the start of the new screen. |
| 2.4.4 Link purpose | Pass | Links and buttons are named for what they do. |
| 2.4.5 Multiple ways | Pass | Screens are reachable from the sidebar, shortcuts (G then P/R/A) and links in context. |
| 2.4.6 Headings and labels | Pass | Descriptive headings and field labels (YNAB's vocabulary). |
| 2.4.7 Focus visible | Pass | A focus ring on every focusable element (`ui/base.css`), visible in every theme and in forced colors. |
| 2.4.11 Focus not obscured (minimum) | Pass | Focused rows stay clear of the sticky header (0 px). |
| 2.5.1 Pointer gestures | Pass | No multi-point or path gestures. |
| 2.5.2 Pointer cancellation | Pass | Actions fire on release (native buttons). |
| 2.5.3 Label in name | Pass | Visible text is the start of each accessible name. |
| 2.5.4 Motion actuation | N/A | No motion input. |
| 2.5.7 Dragging movements | Pass | Reordering accounts, groups and categories is also in their menus (Move up / Move down). The inspector and column resize handles open Narrower / Wider / Reset width on a click, and take arrow keys. |
| 2.5.8 Target size (minimum) | Pass | axe `target-size` clean after the fixes above. |
| 3.1.1 Language of page | Pass | `<html lang="en">`. |
| 3.1.2 Language of parts | N/A | One language. |
| 3.2.1 On focus | Pass | Focus never changes context. |
| 3.2.2 On input | Pass | Choices in settings dialogs apply on Apply; filters change only the report shown. |
| 3.2.3 Consistent navigation | Pass | The sidebar and plan menu are the same on every screen. |
| 3.2.4 Consistent identification | Pass | The same icons and labels for the same functions. |
| 3.2.6 Consistent help | Pass | Help is in the same places on every screen: the `?`/F1 shortcut list and the plan menu. |
| 3.3.1 Error identification | Pass | Field errors are described in text next to the field (amounts, names, dates). |
| 3.3.2 Labels or instructions | Pass | Every field has a label; amount fields explain arithmetic. |
| 3.3.3 Error suggestion | Pass | Errors say what to enter ("Give your plan a name."). |
| 3.3.4 Error prevention (financial) | Pass | Every change can be undone; destructive actions confirm; Plan Reset and Fresh Start preview before saving. |
| 3.3.7 Redundant entry | Pass | Payee defaults, import mappings and recent values fill themselves in. |
| 3.3.8 Accessible authentication | N/A | No sign-in, ever. |
| 4.1.2 Name, role, value | Pass | axe clean; UIA tree has names and states for every control. |
| 4.1.3 Status messages | Pass | Toasts are live regions (polite; errors assertive); Ready to Assign announces changes. |

## Re-running

- `pnpm smoke` includes the axe test on the release build.
- `apps/desktop/node_modules/axe-core` is a development dependency only: it never ships in the app, and it makes no network calls.
