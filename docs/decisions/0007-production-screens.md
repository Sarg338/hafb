# ADR 0007 — Production screens are rebuilt from the component library

- **Status:** Accepted (2026-10-08), Phase 4.
- **Context:** Phase 3 shipped the approved S3.1 mockups (`src/design`) and wired the app shell to them. They are hand-built tables on one global stylesheet (`design.css`). They don't virtualize, and their keyboard model is ad hoc. DESIGN.md's open items say Phase 4 rebuilds them from the library, without changing the approved look (Sarg: keep the current look; make themes technically possible, don't add any).

## Decision

- **Location:** production screens live in `apps/desktop/src/screens/<area>/`: `plan/`, `accounts/` (account dialogs and the register) and `shared/`.
- **Building blocks:**
  - Screens are built only from `src/ui` components and the `DataGrid`, styled with CSS Modules over theme tokens.
  - `sourceScan.test.ts` holds `src/screens` to the same strict rules as `src/ui`.
- **Pure view models:** each screen's display logic is a pure module next to it, tested with Vitest. Examples: rows for the grid, filters, labels, search parsing.
  - Components only render those models and dispatch store commands.
  - Budget numbers come only from the engine (CLAUDE.md §10).
  - `design/planModel.ts` and `design/planView.ts` move to `screens/plan/`, and the mockups import them from there.
- **Look parity:**
  - The approved mockup captures in `.impeccable/review/` are the visual reference.
  - Every screen is checked side by side against its mockup in light, dark and high contrast before its sprint closes.
  - Differences must be deliberate (a new control the mockup didn't have) and are listed in the sprint notes.
- **Per-device preferences:** collapsed groups, progress bars on/off, Hide Amounts and column widths live in `shell/prefs.ts` (localStorage), keyed by plan path where they are per plan. They are never stored in the plan file; the file holds budget data only.
- **Keyboard:**
  - Plan and register shortcuts follow YNAB's published list ([keyboard shortcuts](https://support.ynab.com/en_us/keyboard-shortcuts-Skw9Xp9A9.md), fetched 2026-10-08). It replaces the unverified entries in `ynabShortcuts.ts`.
  - Date fields use YNAB's keys: + and − for a day, T for today, M and Shift+M for the start and end of the month, Y and Shift+Y for the start and end of the year. PageUp and PageDown are kept as extras.
- **Mockups:** `#/design` stays as a dev-only reference until M1, then is retired with the S3.1 stylesheet.
- **Inspector:** the S3.1 inspector stays embedded until S5.1 rebuilds it. Phase 4 changes only what its sprints need, such as the move-money entry points.

## Consequences

- One rendering path per screen, virtualized and keyboard-complete, with no global CSS.
- Look regressions are caught by capture comparison, not by eye alone.
- `design.css` is still loaded while the inspector and Reflect screens depend on it. It goes away in S5.1 (inspector) and S6.1 (Reflect).
