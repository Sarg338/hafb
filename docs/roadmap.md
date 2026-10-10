# HAFB Roadmap: Phase 0 → v1.0 (full YNAB parity, professional UI)

- **Written:** 2026-10-08, after Phase 0 was validated (ADR 0001).
- **Source of truth:** CLAUDE.md wins on rules. This file sets the order of work. `docs/ynab-parity.md` is the feature-by-feature checklist; every row maps to a sprint here.

## How we work

- **Sprint:** one coherent, demoable slice, typically 1–3 working sessions. It isn't tied to dates.
- **Ending a sprint:**
  - Engine sprints end with green tests and an updated `docs/budget-math.md`.
  - UI and Rust sprints end with `pnpm build` and a numbered **validation script** for Sarg to run on the real machine (CLAUDE.md §1).
  - A sprint is done only when that validation passes.
- **Every UI sprint runs:** design spec → build → design review (heuristic + accessibility audit) → Sarg validation. No screen ships without its empty, loading, error and overflow states.
- **Phase gates:** a phase closes only when every sprint in it is validated. Status is updated in CLAUDE.md §7.
- **Decisions get ADRs:**
  - `docs/decisions/NNNN-*.md`, one per choice.
  - Upcoming: undo/command architecture (S2.3), styling approach (S3.2), charting (S6.1), attachment storage (S7.6, ADR 0009).
- **Look and feel** (Sarg, 2026-10-08): HAFB presents the plan, transactions and data **in a very similar way to YNAB**: the same screen structure, columns, available pills and progress bars, inspector, register layout and vocabulary (CLAUDE.md §9), so YNAB users feel at home. HAFB keeps its **own visual identity** (colors, logo, illustrations, typography details) and never copies YNAB's branding or artwork.

## Timed follow-ups

| When | Check | Why | Status |
|---|---|---|---|
| **On or after 2026-11-01** (before the YNAB trial ends, early Nov) | Open the trial's mortgage account (`house`, in the archived plan) and record the **interest transaction YNAB posted**. HAFB predicts **$1,000.00** ($200,000 × 6.00% ÷ 12). | **Sarg's requirement: estimators must be as accurate as possible, not just the budget math.** The payoff simulator's totals now match YNAB to the cent (2026-10-09: closed-form annuity, budget-math §10.5). What's left is the posted monthly charge (§10.4): if YNAB's differs from $1,000.00, fix `postLoanCharges` to YNAB's date and formula. | ⏳ |
| Optional, any time before the trial ends | Trial extra: try to change an unlinked checking account with transactions to Credit Card. | Shows whether YNAB still allows type conversion; that decides whether the public sample's 95 converted-card values (Q8) matter for import. | ⏳ |

## Milestones

| Milestone | When | Meaning |
|---|---|---|
| **M0 – Stack validated** | Phase 0 ✅ | Tauri 2 + React + SQLite proven on hardware. |
| **M1 – Daily driver** | end of Phase 4 | Sarg runs his real budget in HAFB alongside YNAB for 2 weeks and the numbers match to the cent. |
| **M2 – Planning parity** | end of Phase 5 | Targets, auto-assign, scheduled, payees and reconcile. A full monthly workflow is possible without YNAB. |
| **M3 – Feature parity** | end of Phase 6 ✅ (signed off 2026-10-09) | Every non-server row in `ynab-parity.md` is `done`, except optional bank sync, which Sarg moved to S8.6 as the very last item before v1.0. |
| **v1.0** | end of Phase 8 | Professional polish, accessibility, performance at scale, privacy audit, installer, docs, beta, and last, optional SimpleFIN bank sync (S8.6). |

## Inputs needed from Sarg (blocking dates)

| Needed by | Input |
|---|---|
| — | ~~Sarg's own YNAB export~~: **Sarg has no YNAB account.** Golden data comes from a public real export kept local-only (`packages/engine/test/fixtures/local/`, git-ignored, never committed), plus optionally a YNAB free-trial scenario (below). |
| S1.7 (optional) | A **YNAB free-trial scenario**: we write a scripted month of transactions covering splits, targets, credit overspending, future assignments and loans. Sarg enters it in a YNAB trial, exports it, and screenshots the open items (D7, D11, D12). This is the only way to verify those items and to get splits and targets into a golden file; the public sample has neither. |
| — | ~~Sample bank files from your banks~~: Sarg has none; 50 public sample exports from real banks were accepted instead (2026-10-09). |
| S8.6 | A SimpleFIN Bridge subscription and a setup token for the Regions accounts. |
| — | ~~S8.1: a slower (2019-era) laptop, or throttle the CPU~~: throttled instead (2026-10-10). The power plan's maximum processor state at 70% makes this PC's Ryzen 7 5700X about 1.65× slower per thread (measured on the engine recompute), roughly a 2019 Core i5-8265U laptop; the setting was put back afterwards. |

## Spec changes (approved by Sarg 2026-10-08; applied to CLAUDE.md §4–§7)

The 2026-10-08 research (YNAB What's New and help center) found that CLAUDE.md was out of date in these places. Sarg approved every change, and CLAUDE.md now reflects them. **D7, D11 and D12 still need verification** against Sarg's YNAB data (scheduled in S1.7, S4.3 and S7.2).

| # | CLAUDE.md before | YNAB now (2026) | Adopted rule |
|---|---|---|---|
| D1 | "Budget" | Renamed **Plan** (May 2025); reports = **Reflect** | UI says Plan everywhere; the file is still "a budget file" (.hafb). |
| D2 | Target types (Needed for Spending / Savings Balance / Monthly Savings Builder / Have a Balance of) | **Cadence** (Weekly/Monthly/Yearly/Custom) × **behavior** (*Set aside another* / *Refill up to*; *Have a balance of* only on non-repeating Custom). Edits apply to all months. Refunds don't count. | Adopt the new model and map legacy types on YNAB import. |
| D3 | Scheduled: auto-enter on launch with a review prompt | Due scheduled transactions appear in the register **bold and unapproved**; no prompt | Match YNAB. Requires an `approved` flag on Transaction. |
| D4 | No approval/matching | **Approve / reject / match / unmatch.** Unapproved transactions still count. Rejected imports never re-import. Entered and scheduled transactions auto-match imports (same amount, ≤ 10 days). | Add for file import (S6.5); schema fields in S2.1. |
| D5 | Payee default category = last used | Changes only when **2 of the last 3** agree; a fixed per-payee default is possible; auto-categorize can be turned off per payee | Match YNAB. |
| D6 | Budget accounts / tracking accounts | Sidebar groups **Cash, Credit, Loans, Tracking, Closed**, plus **Starred**. Tracking = Asset/Liability only. Cash-type transactions are auto-cleared. | Match YNAB. |
| D7 | Age of Money: FIFO, last 10 outflows, cash accounts only | Last 10 cash outflows; **CC payments count**; transfers and starting balances excluded; YNAB doesn't publish FIFO; shown in Reflect (not the header) | Verify against Sarg's export in S1.7 and document the observed algorithm. |
| D8 | Redo = Ctrl+Y | **Ctrl+Shift+Z** | Support both (Ctrl+Y is the Windows convention). |
| D9 | Search: `category:`, `payee:`, `>` … | Criteria syntax: `Category: Dining Out, Outflow: >=30`; Before/After/On; flag, Split, Matched, Approved, `is:` | Match YNAB's syntax exactly. |
| D10 | — | New features (Focused Views, Plan Reset, Cost to Be Me, Assigned in Future, cover from future months, Recent Moves, Hide Amounts, Templates, photos, Record Payment, Reduce Overfunding, …) | Add to §6 (already rows in `ynab-parity.md`). |
| D11 | RTA breakdown popover: left over / assigned / inflow / assigned in future | Unverified; the Inspector documents a different breakdown | Confirm in Sarg's YNAB before S4.3. |
| D12 | Fresh Start = new budget seeded from current one | Old plan archived (dated, "Archived" stamp); keeps scheduled, targets, expected income, notes, payees; $0 starting balances | Match YNAB. |
| D13 | File import dedupe | Skip transactions > 3 days before the last reconciliation; keep zero-amount rows; imported cash inflows default to Ready to Assign | Match YNAB. |

---

## Phase 1: Budget engine (pure TypeScript, tests first)

> **Status: done, signed off by Sarg 2026-10-08.** Tests were run on Sarg's machine. The YNAB-trial check of the §13 rules is pending (`docs/ynab-trial-scenario.md`; predictions frozen).
> - **Tests:** 221 tests (186 engine), and a 400-plan property test of the reconciliation identity.
> - **Golden test:** 98.4% of YNAB's own values match to the cent, including every regular category. The 95 payment-category values that differ are documented in budget-math §12.
> - **Performance:** recompute median 14.8 ms against the 50 ms budget.
> - **Unverified rules:** Ready to Assign breakdown fields, Age of Money, target formulas beyond YNAB's examples, loan accrual and reports. They're listed in `docs/budget-math.md` §13 with the sprint each blocks, and the optional YNAB-trial scenario is the way to verify them.
> - **Not in this phase:** S1.0's "get the YNAB export" was replaced by the public local sample, because Sarg has no YNAB account.

**Goal:** all of CLAUDE.md §5 (as amended by D1–D13), with no UI. Every rule gets worked examples in `docs/budget-math.md` and a test, and there's a golden test against a real YNAB export.

| Sprint | Scope | Done when |
|---|---|---|
| **S1.0 Spec reconciliation** | ~~Apply the approved spec changes to CLAUDE.md~~ (done 2026-10-08). Write the skeleton of `docs/budget-math.md` (one section per rule, examples filled per sprint). List open YNAB questions with the sprint each blocks. Get the YNAB export from Sarg. | `budget-math.md` skeleton committed; question list answered or scheduled. |
| **S1.1 Foundations** | `@hafb/shared`: `Minor` helpers (add/sub/mul/divRound with round-half-up), currency decimals, month/date math (add months, last-day clamping, weekdays), typed errors (`InvariantViolation`, `ValidationError`). Domain types (§4). `computeBudget(snapshot, { today })` signature. Benchmark harness. IDs are passed in, never generated (pure). | Helpers 100% branch-covered; types compile under strict flags. |
| **S1.2 Core identity & Ready to Assign** | Activity, carryover, cash overspending → next month's Ready to Assign, Ready to Assign (incl. money assigned in future months), breakdowns, starting balances, tracking accounts excluded, transfer rules (§5.9), multi-month rollovers, hidden/deleted categories. | Worked examples for §5.1, §5.2 and §5.9 pass. |
| **S1.3 Credit cards** | Payment-category money movement, credit overspending carried as negative, refunds, payments, mixed cash+credit overspending edge cases, the pay-in-full gap and underfunded alert data. CC interest categorization (D10, rolling out) behind a flag. | §5.3 examples pass, including every documented edge case. |
| **S1.4 Targets** | Cadence×behavior model, legacy mapping, underfunded per cadence (weekly by weekday, monthly by day, yearly, custom ± repeat every N months), statuses, snooze, progress-bar segment data (rollover/weekly/extra), Cost to Be Me totals, expected income. | Matches YNAB's published underfunded logic on the help-center examples. |
| **S1.5 Plan operations** | Move money; cover overspending (incl. **from future months**); auto-assign (Underfunded, Assigned/Spent Last Month, Average Assigned/Spent, **Reduce Overfunding**, Reset Available/Assigned) with preview totals, scoped to a category set (for Focused Views); **Plan Reset**. | Every operation is a pure function returning the `assigned` deltas; rounding tests for the averages. |
| **S1.6 Transaction logic** | Split invariant; scheduled recurrence (all 13 frequencies, 31st → last day, next-date math); reconciliation math and adjustment; search parser and evaluator (D9 syntax); payee default category (D5) and rename rules; approval-state effects (unapproved still counts). | Parser has its own test table covering every documented criterion. |
| **S1.7 Age of Money, loans, Reflect math** | Age of Money (D7, verified on real data); loan interest accrual, escrow, payoff simulator (payment ↔ date, extra payments, interest saved); report aggregations as pure functions: spending breakdown and trends, net worth by month, income v expense. | Loan formula documented with sources; report functions tested on fixtures. |
| **S1.8 Golden tests & performance** | YNAB CSV parser (shared with S2.4; strings → minor units, never floats; **locale-aware**: the export uses the plan's currency and date format, see `docs/ynab-references.md`). Golden test: feed the local public sample's register and assigned amounts to the engine and match YNAB's own **Activity and Available for every category and month to the cent** (58 months × 51 categories, 36 accounts, ~7.5k transactions). Skipped automatically when the local file is absent, so CI and clones stay green. Optionally also the trial scenario. Perf: 5 years × 100 categories recompute in < 50 ms. Complete `budget-math.md`. | `pnpm test:engine` green, with the golden test run locally; Phase 1 gate. |

## Phase 2: Persistence, commands & import

**Goal:** a real `.hafb` file you can open, edit with undo, and fill from a YNAB export.

**Status: done, signed off by Sarg 2026-10-08.** All five sprints were validated on Sarg's PC by driving the release build. Design in ADR 0002, including its §10 amendments:
- **S2.1:** STRICT schema; the split check is a view rather than a trigger.
- **S2.2:** a 20k-transaction plan opens and loads in 24 ms (release build).
- **S2.3:** the undo property test runs 200 random sequences. Zustand wiring moves to S3.3; the dev screen uses a plain external store.
- **S2.4:** the trial export matches 34/34 values; the public sample matches 5821/5916, the same as the engine golden.
- **S2.5:** the Phase 0 SQLite spike is still in the spike screens and is retired with them in S3.3.

| Sprint | Scope | Done when |
|---|---|---|
| **S2.1 Schema v1** | `0001_init.sql` from the amended §4: soft deletes, `approved`/import fields (D4), starred accounts, focused views, payee auto-categorize settings, expected income, the split-sum trigger. Rust migration runner with **automatic pre-migration backup**; WAL; `cargo test` for migrations. | Fresh and migrated files pass the schema tests. |
| **S2.2 Data access** | Thin, typed Rust commands: a snapshot load (fast path for 20k+ transactions) and batched mutations in one SQLite transaction. TS bindings in `@hafb/shared`. | Snapshot of a 20k-transaction file loads in < 300 ms on Sarg's PC. |
| **S2.3 Commands & undo** (ADR) | Command objects with inverses; multi-change commands (e.g. auto-assign) as one undo step; session command log persisted; feeds Recent Moves; engine result caching and invalidation; Zustand store wiring. | Property test: any command sequence followed by full undo restores the starting snapshot. |
| **S2.4 YNAB import** | `pnpm import:ynab <zip> <out.hafb>`: plan history, register, transfers, splits, CC payment categories, flags, cleared state; targets gap documented with a re-entry list. | Imported file reproduces Sarg's YNAB numbers (S1.8 golden). |
| **S2.5 Budget files** | Create, open and recent files; single-writer lock; auto backups on open (keep N); restore; "save a copy". Retire the Phase 0 SQLite spike. | Sarg opens his imported file from the app on hardware. |

## Phase 3: Design system & app shell (the "professional" foundation)

**Goal:** a cohesive, Windows-native design language and the reusable pieces every screen is built from, *before* building screens.

**Status: done, signed off by Sarg 2026-10-08.** Every Phase 3 sprint was built and validated on Sarg's PC by driving the release build.
- **S3.3:**
  - The app shell replaces the Phase 0 spike and Phase 2 screens: welcome screen, sidebar with plan menu and rail, routing, resizable inspector, prefs, theme switching (Match Windows follows contrast themes too), window title, window state restore, `--open`.
  - The approved S3.1 screens render the real plan.
  - Snap Layouts flyout confirmed on the custom title bar.
- **S3.4:** `DataGrid` (TanStack Table + Virtual).
  - The 50k-row benchmark in the real WebView2 missed 0 frames, both for steady scrolling (600 frames) and a fling through all rows (301 frames).
  - Windows UI Automation exposes each cell as a named data item with its row and column, which is what Narrator reads.
- **S3.5:**
  - Scoped shortcut registry with the `?` overlay and an on/off switch.
  - Route focus and skip link; error boundaries and global error toasts.
  - `pnpm smoke`: 9 end-to-end tests on the release app, all passing. Launch to first paint took 812 ms.
  - The smoke suite connects Playwright over WebView2's DevTools port instead of tauri-driver (ADR 0005).
- **Earlier:** S3.1 **approved by Sarg** (all Phase 3 design changes approved). S3.2 is built: the component library is in `src/ui`, the gallery at `#/gallery`, and styling uses CSS Modules (ADR 0004). Whole-UI theming is in place as plumbing only: a test fixture and a source scan prove it, and the S3.1 mockups are still pixel-identical.
- **Checked in the batched capture:** every gallery section in light, dark and high contrast, and at 150% and 200% scale.
- **Checked in the real app** by driving the release build: money math, date keys, the category picker, menus and context menu by keyboard, and the dialog's focus return.
- **Bugs fixed from those checks:**
  - Popover focus while measuring.
  - Document overflow from screen-reader-only text.
  - The high-contrast disabled button.
  - Shortcut chips for the "+" key.
- **Direction:** Sarg chose the familiar, YNAB-like look. The quality bar is YNAB web, Monarch and Copilot Money.
- **Design spec:** `DESIGN.md`, with the full token list in `.impeccable/design.json`.
- **Theming:** themes are data (ADR 0003).
- **Mockups:** at `#/design` (the "Design mockups" link on the home screen). They run the real engine on a sample household.
- **Review:** finish review in two rounds. Its remaining items were fixed after the second verdict.

| Sprint | Scope | Done when |
|---|---|---|
| **S3.1 Design direction** | Information architecture (Plan / Reflect / Accounts, sidebar, inspector). HAFB visual identity, Fluent-aligned, Segoe UI Variable. Density spec (34 px plan rows, 30 px register rows). Type scale with tabular numerals. Color system for light, dark and **high contrast**, with semantic status colors (funded/underfunded/overspent/snoozed) and a **"differentiate without color"** alternative. Clickable mockups of Plan, Register, Inspector and Reflect. | Sarg approves the mockups; a design spec doc is committed. |
| **S3.2 Tokens & primitives** (ADR: CSS modules vs vanilla-extract) | Design tokens; button, icon button, text and **money input with math** (+ − × ÷), date picker with YNAB keys (+/−, T, M, Y), grouped searchable **combobox** (payees, categories), checkbox, toggle, segmented control, chips, menu and **context menu**, popover, dialog, **toast with Undo**, tooltip with shortcut hints, segmented progress bar, progress ring. Dev-only component gallery route. | Gallery reviewed on hardware at 100%, 150% and 200% scale, light/dark/high contrast. Components use shape, type and density tokens, not only colour. The look is unchanged from the approved S3.1 values, and no new theme ships (Sarg, 2026-10-08). Feasibility is proven by a test-only fixture theme and a source scan for hard-coded colours, fonts, radii and rules (ADR 0003 amendment). |
| **S3.3 App shell** | Sidebar (plan menu, Plan/Reflect/All Accounts, account groups with totals, Starred, collapse), title bar, routing, resizable inspector panel, window-state persistence, theme switching. Retire the spike screens; keep the grid benchmark in the gallery. | Shell navigates on hardware; snap layouts still pass. |
| **S3.4 Editable grid foundation** | One reusable virtualized grid for Plan and Register: keyboard model (Enter commits, Tab moves, Esc cancels, Ctrl+Enter saves and adds another), row selection (click/Shift/Ctrl, checkboxes), inline editors, column sizing, collapsible group rows, ARIA grid semantics. | 50k-row benchmark still 0 missed frames; Narrator reads cells. |
| **S3.5 Interaction infrastructure** | Scoped keyboard-shortcut registry (`?` overlay, global disable), focus management, error surfacing (typed engine errors → toast), Playwright + tauri-driver smoke suite in CI-able form. | Smoke suite passes locally; shortcut overlay lists the registered keys. |

## Phase 4: Daily driver (Plan, accounts, register, credit cards) → **M1**

| Sprint | Scope | Done when |
|---|---|---|
| **S4.1 Plan screen (read)** | Header (month navigation, month note, Ready to Assign banner: green / "All Money Assigned" / red), group and category rows with Assigned/Activity/Available pills and segmented progress bars, collapse/expand all, Display Options (progress bars on/off, balance style). | Matches the engine for Sarg's real file, month by month. |
| **S4.2 Plan editing** | Inline assign with math, category and group CRUD, drag reorder, hide/unhide, delete with reassignment, category notes, multi-select. | Every edit undoable, with a toast. |
| **S4.3 Moving money** | Move-money popover from Available, cover overspending (incl. from future months), Ready to Assign breakdown (D11), negative-RTA and future-RTA alerts, overspent banner. | The YNAB "fix overspending" workflow is possible with the keyboard only. |
| **S4.4 Accounts** | Add account (all types incl. loan details), edit/close/reopen, starting balance, sidebar groups (D6) and Starred, reorder, notes, register header (cleared + uncleared = working balance). | All account types create correctly; totals tie to the engine. |
| **S4.5 Register core** | Register grid; inline add/edit; payee picker (transfers group, saved payees, manage payees); category picker with available amounts and suggestions; transfers (both legs); cleared toggle (auto-cleared for cash); flags with custom names; memo; date picker; optional running balance. | A month of real transactions entered by keyboard only. |
| **S4.6 Register power** | Splits with "amount remaining"; multi-select **floating action bar** and right-click menu (categorize, memo, flag, date, payee, move account, delete, duplicate Shift+D); search with criteria chips (D9); sort; view options (date presets, show reconciled); All Accounts register; uncategorized/unapproved banners. | Bulk edit of 1,000 rows < 200 ms; search syntax table passes end to end. |
| **S4.7 Credit cards** | Payment-category UI, activity popover (spending / returns / funded / payments), **Record Payment**, pay-in-full gap and underfunded alert, credit overspending display, CC interest handling (if D10 adopts it). | Sarg's real cards match YNAB for 2+ months. |
| **S4.8 Undo everywhere + M1** | Ctrl+Z / Ctrl+Shift+Z (+ Ctrl+Y) on every action with descriptive toasts; edge-case sweep; performance re-check on the real file. | **M1:** two weeks of parallel use, and the numbers match. |

**Phase 4 progress** (production screens per ADR 0007):
- **S4.1 done (2026-10-08).**
  - What's built:
    - The Plan screen is rebuilt in `src/screens/plan` on the DataGrid: month picker, month note, Ready to Assign banner with an Assign menu, Focused View chips and the Hidden Categories section.
    - Collapse and expand all with Ctrl+Up/Down; the collapsed groups are remembered per plan.
    - Display Options: progress bars on or off, differentiate without color.
    - Hide Amounts covers the Plan, sidebar, inspector, register and Reflect.
    - Below 1366 px the money columns narrow, as in the approved layout.
  - Shortcuts: the full verified list is in `ynabShortcuts.ts`. Date keys follow YNAB: Shift+M and Shift+Y end the month and year.
  - Exit check: `pnpm smoke` drives the release app through every month of the public YNAB export (59 months, 3,363 rows) and the trial plan, and every name, Assigned, Activity, Available and Ready to Assign value matches the engine.
  - Look: compared with `.impeccable/review/desktop.png`. The only differences are rows 0.6 px shorter (the DataGrid's 34 px token) and Recent Moves shown disabled until S5.7.
- **S4.2 done (2026-10-08).**
  - Editing:
    - Click a name to rename it; the same popover has Hide and Delete.
    - The row menu (right-click, Shift+F10 or the Menu key) offers rename, add a category, move up/down, hide/unhide and delete.
    - **+ Category Group**, plus a hover **+** on each group to add a category.
    - Drag to reorder categories (within and across groups) and groups.
  - Rules and feedback:
    - Delete asks where the history goes only when there is some. A store change made `reassignTo` optional for unused categories, with tests.
    - Hides, deletes and moves toast with Undo, and a newer toast replaces an older Undo toast.
    - Credit Card Payments stays first, and its categories can't leave it.
  - Exit check: smoke tests in the release app cover rename, add, hide, delete-with-reassign and drag, each undone. Ready to Assign is unchanged, and a dragged order survives a relaunch.
- **S4.3 done (2026-10-08).** Built from YNAB itself: Sarg's trial plan, driven directly, with every test edit undone.
  - Moving money:
    - Click or Enter on Available opens **Move** ("Move [full Available] To [category]") or **Cover overspending from** [Ready to Assign, categories with money, money assigned in future months].
    - **Assign** opens tabs: Auto (the options with amounts) and Manually ("Assign [Ready to Assign] To").
  - Ready to Assign:
    - The **Ready to Assign Breakdown** shows non-zero lines and the total.
    - Negative shows **Fix This** ("Un-assign money from").
    - A **Today** button appears off the current month.
    - *Assigned in Future Months* in the inspector warns when a later month is short.
  - Rule corrections from YNAB:
    - Future assignments never take this month below zero. The engine changed, with tests (budget-math §2, examples 2.5–2.6).
    - Overspending only on credit is yellow with a card icon; cash overspending stays red.
  - Exit check: smoke tests in the release app cover overspending fixed with the keyboard only, move money with the breakdown total, and Fix This plus the future-month shortfall.
- **S4.4 done (2026-10-08).** Checked against YNAB's own dialogs in the trial plan.
  - Add Account:
    - Fields: nickname, type and balance. Types are grouped Cash / Credit / Mortgages and Loans / Tracking.
    - Loans also take an interest rate and the monthly payment the lender requires.
    - Debt is entered as the amount owed and stored negative. This is HAFB's own choice: YNAB's form doesn't say which sign to use.
  - Edit Account:
    - Nickname, notes and loan details.
    - Working balance: a change adds a **Manual Balance Adjustment** (verified: cleared, dated today, Inflow: Ready to Assign).
    - Close Account: a balance is zeroed with an adjustment after a warning (YNAB's documented behavior). Reopen is available too.
  - Store:
    - New `adjustBalance` command.
    - `closeAccount` takes `zeroOut`.
  - Sidebar:
    - Account menu (right-click or Shift+F10): edit, star/unstar, move up/down, close/reopen.
    - Drag to reorder within a section.
    - Star and edit buttons in the register header.
  - Exit check: a smoke test in the release app creates one account of every type and checks balances, section totals and Ready to Assign. Edit, close-with-balance, reopen and star are covered too.
- **S4.5 done (2026-10-08).** The register is rebuilt on the DataGrid (`screens/accounts/RegisterScreen.tsx`, view model `registerModel.ts`).
  - Editing:
    - The whole row opens for editing, with an edit strip under it (Cancel / Save and add another / Save).
    - Enter saves, Esc cancels, Ctrl+Enter saves and opens another row, Tab moves between fields. Saving an unapproved transaction approves it.
    - Fields: account (All Accounts), date (YNAB date keys), payee (Payments & Transfers, saved payees, create a new one), category (with available amounts), memo, outflow/inflow (with math), cleared.
  - Rules:
    - Transfers: both legs; between two budget accounts the category is "Category not needed"; budget → tracking keeps one (§5.9).
    - Cash accounts default to cleared.
    - A payee's default category fills an empty category.
  - Labels follow YNAB: "Transfer : X", "Payment: X", "Category not needed", "Split (n)" with split lines under the row (split editing is S4.6).
  - Shortcuts: Shift+N, C, Shift+F then 0–6, Delete, Ctrl+Shift+F. Rows also have a right-click menu.
  - Flags: six colours with custom names (Flag names dialog; `setFlagName` in the store).
  - View menu: Show running balance (engine `runningBalances`: oldest first, entry order within a day).
  - Bug found by the smoke test: money and date fields selected their text a frame after focus. A fast keystroke was overwritten, and tabbing on quickly pulled focus back to the previous field. Both fields now skip the late select once the user types or focus moves on.
  - Exit check: a smoke test in the release app enters a month of transactions with the keyboard only, adds a transfer, edits, clears, flags, deletes and undoes; balances tie out and survive a relaunch.
- **S4.6 done (2026-10-08).** Checked against YNAB in the trial plan (only selections and menus; one duplicate made and deleted).
  - Selection:
    - Checkboxes, Shift/Ctrl-click; the header shows **Selected Total (n)**.
    - A floating bar: "n Transactions", Categorize, Flag, Clear (only when something is uncleared), Approve (when something is unapproved), More.
    - More: Match, Unmatch, Duplicate, Memo…, Move to Account, Export, Delete.
    - Right-click selects just that row unless it is already selected. Its menu follows YNAB: Approve, Reject, Mark as Cleared/Uncleared, Match, Unmatch, Duplicate, Make Repeating, Flag, Memo…, Categorize, Move to Account, Export, Delete. Items for later sprints show disabled.
    - A click on the only selected row edits it (YNAB).
  - Store:
    - `editTransactions`: one command for many rows. A field skips rows it does not apply to.
    - `duplicateTransactions`: the copy keeps date, amount, payee, category, memo, flag and cleared state. A reconciled row's copy is cleared; a starting balance copies with no payee. Verified in YNAB.
    - Bulk categorize of 1,000 rows on a 20,000-row plan is well under 200 ms (store test).
  - Splits:
    - S, or "Split (Multiple Categories)…" at the end of the category picker, starts two empty lines.
    - Each line has payee or transfer, category, memo, outflow and inflow, plus a remove button.
    - "Add another split" and "Amount remaining to assign" sit under the amount columns. Saving needs the remainder at $0.00.
  - Shortcuts: A, Shift+L (approve all), K (categorize), S (split), Shift+D (duplicate).
  - Search:
    - YNAB's criteria syntax through the engine parser. A bad criterion shows its error instead of an empty list.
    - A search shows only the split lines it matched and hides the Scheduled section.
    - The "Some transactions are hidden by your search" note with View All sits above the grid, so the floating bar never covers it.
  - Sort: a header click sorts descending first; the sorted column flips (YNAB).
  - View Options (per register, kept in prefs): This Month, Last Month, Latest 3 Months, This Year, Last Year, All Dates, From/To months, Show Reconciled Transactions, Show Flags, Show Running Balance (single account).
    - Assumption: YNAB's default for Show Reconciled could not be confirmed, so HAFB shows reconciled rows by default.
  - Banners: unapproved (Review / Approve all) and "n transactions need a category" (View filters to them).
  - Bugs found and fixed:
    - The grid ignored clicks on its own row checkboxes (a regression from the S4.5 change that lets controls in cells keep their clicks).
    - Only a sort header's words were clickable; the whole header cell now sorts.
    - Starting a split by keyboard could leave focus on the parent row in the release build.
  - Exit check: smoke tests in the release app cover bulk categorize with one undo, duplicate selecting the copies, a keyboard split that survives a relaunch, the search syntax table, header sort and the Last Month preset.
- **S4.7 done in code (2026-10-08); the real-card check is part of M1.** Built from the YNAB trial plan's two cards (views only; one charge cleared and uncleared again to see Record Payment).
  - Engine: `CreditCardMonth` gained gross `spending` and `returns` (budget-math §3.14, test 3.14).
  - Plan:
    - A payment category holding less than its card owes is yellow in the current month: "Cover $X in overspent categories", or "$X more needed to pay off the balance".
    - The Credit Card Payments group's total is labelled "Payment".
  - Activity popover: a click or Enter on any Activity amount lists that month's transactions (split lines at their own amount). A payment category adds YNAB's summary: Spending, Returns, Total Spending | Funded Spending, Payments & Returns, Total Activity.
  - Inspector (the mockup's, until S5.1): a payment category shows Available for Payment (cash left over, assigned, funded spending, payments made) and Current Balance (prior, spending and outflows, payments and inflows).
  - Card register: "Overspending (Oct)" and "Payment" pills; **Record Payment** opens a new row pre-filled with min(Available, cleared debt).
  - Verified: on the trial export, amex and visa match YNAB's popovers, pills and Record Payment amount to the cent (`smoke/trialCards.check.ts`). My first reading of "Payments & Returns" was wrong; YNAB's visa numbers corrected it.
  - Not yet: Credit Card Interest categorization (YNAB has not documented it and it isn't in the trial), and the payoff-target alert (T-12, with targets in S5.2).
  - Exit check: a smoke test in the release app ties the payment row, the Activity popover and the card pills together, then pays the card with Record Payment and sees the payment category drop by that amount.

## Phase 5: Planning power → **M2**

| Sprint | Scope | Done when |
|---|---|---|
| **S5.1 Inspector** | Plan view (Available in month: left over + assigned + activity; Cost to Be Me with expected income; Assigned in Future with per-month amounts and next-month funded pie; future negative-RTA alert); category view (available balance breakdown, upcoming scheduled, "available after upcoming"); multi-select totals. | Every figure ties to the engine; collapsible state persists. |
| **S5.2 Targets** | Target editor (cadence segments, "I need / By", behavior choice with explanations, custom repeat every N months), Edit Plan mode, progress ring, statuses, snooze (Shift+Z), weekly/rollover/extra progress segments, target suggestions from history. | Every cadence×behavior combination matches the S1.4 tests in the UI. |
| **S5.3 Auto-assign, Focused Views, Plan Reset** | Inspector auto-assign list with live amounts and preview; built-in view chips (Underfunded, Overfunded, Snoozed, Money Available, conditional Overspent) and up to 12 custom views (create/reorder), remembered per device; auto-assign scoped to the view; Plan Reset with confirm and undo. | Auto-assign is one undo step; view scoping verified. |
| **S5.4 Scheduled transactions** | Create/edit with all frequencies; collapsible Scheduled section; due items appear bold and unapproved (D3); enter now / skip; make repeating (Shift+T); recurring icon; calendar icon on Available when an upcoming bill won't be covered. | Month-end and leap-year recurrence verified in the UI. |
| **S5.5 Payees** | Payee manager (rename, combine, delete), learned rename rules ("Rename future 'AMZN*' to 'Amazon'?"), default category (D5) plus fixed default and auto-categorize toggle, transfer payees. | Rules apply to entry and (later) import. |
| **S5.6 Reconciliation** | Reconcile flow (Shift+E): confirm cleared balance → match, or "Let's fix it" adjustment; lock icons; reconciled-edit warning; hide/show reconciled; "Reconciled N days ago". | Reconciling Sarg's real accounts works with no surprises. |
| **S5.7 Recent Moves & history + M2** | Recent Moves popover (34 days; All/Moved/Assigned filters; event icons); per-category assigned history (3 months). | **M2:** a full month's workflow on real data with YNAB closed. |

Progress (all built from the YNAB trial plan, 2026-10-08; YNAB was put back as it was after every probe):
- **S5.1 done in code.** Production inspector (`screens/plan/Inspector.tsx`): the month's summary, Cost to Be Me with an inline expected-income editor (one undo step), Assigned in Future with the next month's funded pie, Auto-Assign with live amounts; a category's available-balance breakdown, upcoming scheduled and "available after upcoming"; several selected show their names, summary and Auto-Assign. Sections collapse and stay collapsed. Engine: `upcomingDetails`.
- **S5.2 done in code.** Target card (ring, "Assign $X more", Assign, needed / funded / to go, "You've met your target!" with a check) and the inline target editor (cadences, I need / By / Every / Due on, behaviors with YNAB's "Use for" text, repeat every N months or years); snooze (toggle and Shift+Z); Edit Plan's suggestion from the last three months (`suggestTargetAmount`, an assumption in budget-math §6).
- **S5.3 done in code.** Focused View chips in the stored order, New Custom View and Manage Views (reorder, edit, delete; up to 12), remembered per device and plan file; Auto-Assign scoped to the view; the Reset options confirm first; Plan Reset… previews what returns and what covers overspending, one undo step.
- **S5.4 done in code.** Store commands for schedules (add, edit, delete, Enter Now, Skip, enter due, Make Repeating). The register's "Scheduled Transactions" section; a schedule edits in the row editor with Repeat under the calendar; a future-dated new row becomes a schedule; Enter Now (E), Skip Next, Shift+T. Due schedules enter unapproved on open and when the day changes. Month-end and leap-year recurrence checked in the app (01/31/2028 → 02/29 → 03/31 → 04/30). Enter Now dating an early entry today is an assumption (budget-math §8.1).
- **S5.5 done in code.** Manage Payees (plan menu, and under the payee list): rename, combine and rename, hide (migration 0002 `payees.hidden`), delete with a New Payee prompt (YNAB help: otherwise the payee is left blank), categorization (auto from history / always use my choice / off), renaming rules, transfer payees read-only. Per YNAB, renaming rules apply to imported payees, so they take effect with bank import (S6.5), which also brings the "rename future …?" offer.
- **S5.6 done in code.** Reconcile (Shift+E): "Is your current balance $X?" Yes locks; No asks for the bank's balance and opens a banner that tracks the difference live (Cancel / Create Adjustment & Finish / Finish). The adjustment goes to Ready to Assign (no category off budget). A lock unlocks one transaction after a warning. "Reconciled today / N days ago". Store: `reconcileAccount`, `reconcilePreview`.
- **S5.7 done in code.** Recent Moves (34 days by day, All / Moved / Assigned, YNAB's wording and empty state) and a category's Moves table from the history button by a selected category's Assigned amount.
- Exit checks: smoke tests in the release app cover snooze and undo, a custom view, Recent Moves and a category's Moves, schedules (future row, Enter Now, due entry on open, relaunch), Manage Payees rename and hide, and Reconcile surviving a relaunch.
- **M2** needs Sarg: a full month on real data with YNAB closed.

## Phase 6: Reflect, loans, data in/out → **M3**

| Sprint | Scope | Done when |
|---|---|---|
| **S6.1 Reflect framework** (ADR: charts) | Choose charting (hand-rolled SVG vs a library; must pass the no-network audit). Reflect shell with 5 tabs; category and account tree pickers (Select All/None); timeframe presets and custom range with previous/next; summary side panel; drill-down transaction modal; export CSV/TSV and PNG. | Filters persist; exports open correctly in a spreadsheet app. ✅ OpenOffice Calc, every cell exact (Sarg accepted Calc in place of Excel, which isn't installed; 2026-10-09). |
| **S6.2 Spending Breakdown & Trends** | Donut by group/category, stack-ranked list, positive-inflow section; stacked bars over time with average line; Totals/Trends toggle. | Matches YNAB for the same filters on Sarg's data. |
| **S6.3 Net Worth, Income v Expense, Age of Money** | Assets vs debts bars with net worth line; collapsible income/expense table with average and total; Age of Money chart (6m/1y/2y) with its < 10 outflows empty state; **Share Your Progress** PNG (amounts hidden). | Numbers tie to the engine; the PNG renders at high DPI. |
| **S6.4 Loans & loan planner** | Loan setup (rate, escrow, fees, minimum payment, original principal), monthly interest posting (editable), paired category with Record Payment and Monthly Debt Payment target, payoff calculator (payment ↔ payoff date), what-if extra payments, payoff celebration. | Monthly interest and the payoff simulator (payoff date, payments, **total interest to the cent**) match YNAB; see Timed follow-ups. |
| **S6.5 Bank file import** | CSV (column mapper remembered per account, date-format detection, swap inflow/outflow, semicolons), OFX/QFX (multi-file), QIF. Dedupe by FITID plus fuzzy match. Approve/reject/match/unmatch review (D4); auto-match to entered and scheduled transactions (≤ 10 days); CC payment pairing; skip rule (D13); rename rules applied; inflows default to Ready to Assign. | Real banks' files import with zero duplicates on re-import. ✅ 50 public sample exports from real banks, 11 of them in the release app (Sarg has no exports of his own and accepted the public samples, 2026-10-09). |
| **S6.6 Export & backups** | YNAB-format CSV export (verified to import back into YNAB); raw SQLite copy; backup settings (count, location) and restore UI. | A YNAB-format export imports back into YNAB; a restore round-trips. |

**Signed off by Sarg 2026-10-09** (S6.1–S6.6). S6.7 bank sync moved to **S8.6**, the very last item before v1.0.

Progress (built from the YNAB trial plan, 2026-10-09; YNAB was put back as it was after every probe):
- **S6.1 done in code** (ADR 0008). The production Reflect screen (`screens/reflect/`) replaces the S3.1 mockup in the app: five tabs over one filter bar (YNAB's presets This Month … All Dates, Custom start/end month, previous / next by the range's length, clipped to the plan's months; category and account trees with search, Select All / Select None, "N Selected Categories"), remembered per plan file. Any figure opens its transactions; a row opens the transaction in its register (`#/accounts/<id>?tx=`). Export: YNAB's file layouts (CSV, TSV for decimal-comma currencies; the Spending reports as a zip of summary + transactions) and a PNG of any chart, saved through the native Save dialog. Engine: `spendingLines`, `incomeLines`, `accountBalances`, trend group rollups. The S3.1 stylesheet no longer loads in the app.
- **S6.2 done in code.** Spending Breakdown with YNAB's Categories / Groups toggle, group drill-in and Positive Inflow Categories; Spending Trends stacked by group with the average line, drill into a group, and the month table (Total Spending, Compared to Average). YNAB 2026 has no Totals/Trends toggle.
- **S6.3 done in code.** Net Worth (headline with Change in Net Worth and its percentage, hover per month, month table), Income v Expense in YNAB's layout (Income / All Income Sources / Expense groups with totals, Net Income green or red; any amount drills down), Age of Money (6 months / 1 year / 2 years, empty state, "Understanding Age of Money"), Share Your Progress ("Download and Share": four formats, Show Tagline, Show Amounts; our own look and copy).
- **S6.4 done in code.** A loan's page above its register, laid out like YNAB's: Remaining Balance, Interest Rate, Minimum Payment, Escrow, Payoff Date; Your Loan's Progress (balance remaining and its share of the original, the current track, Share Your Progress, the payoff sentence); pairing a category (existing or new; one loan per category) with Record Payment and the inspector's loan section; the Monthly Debt Payment target with its payoff calculator; the Loan Payoff Simulator (YNAB's fields; the trial mortgage's 30-year track reproduces: Oct 2056, 360 payments); monthly Interest / Escrow / Fees charges posted on the 1st when a plan opens or the day changes; a gear for missing details; a paid-off celebration. The first YNAB interest posting (after 2026-11-01, Timed follow-ups) will confirm the posting date and amount.
- **S6.5 done in code.** File Import in the register opens YNAB's Import Transactions: the account, the files (CSV, OFX/QFX several at once, QIF), CSV column mapping with No header row, Swap Inflow and Outflow, Remember setting for this account (plus the detected date order and decimal mark), OFX/QIF's Import Memos, Swap Payee and Memo, Swap Inflow and Outflow, and a row-by-row preview (new, matched, skipped and why). Imports arrive unapproved and cleared with cleaned payees, renaming rules and payee defaults, and imported cash inflows go to Ready to Assign; entered and scheduled transactions auto-match (same amount, 10 days); Reject, Match, Unmatch and Bank Import Details; card payments imported on both sides pair into a transfer; renaming an imported payee offers a rule. Migration 0003 keeps the bank's date and amount for Unmatch. Tested on 53 public sample exports from open-source finance projects (2026-10-09; downloaded for testing, not committed): OFX/QFX from US Bank, Navy Federal, Wells Fargo, BMO, WaMu, CIBC, RBC, ATB, Fidelity and others; CSV from Capital One, Schwab, a credit union, N26, Outbank, UBS and ING; QIF. 50 import once and skip every row on a second import (in the release app too, 11 files, 239 transactions); the other 3 have no bank transactions (an investment statement, an account list) or a broken date. They found five fixes: extra decimal places in OFX/QIF amounts, CSV header priorities (value dates, Débit/Crédit, Details vs Description, Memo vs Reference), UTF-16 files and double-encoded OFX names. Sarg has no bank exports of his own and accepted these public samples as the exit check (2026-10-09).
- **S6.6 done in code.** Export for YNAB (CSV) in the plan menu writes YNAB's own export: a zip of "<plan> as of <date> <time> - Plan.csv" (every category and month) and "- Register.csv" (every transaction), which round-trips through the YNAB importer to the cent (store test). YNAB has no whole-plan import, so "imports back into YNAB" means its File Import reading the Register rows into an account: checked in the trial's active plan (2026-10-09), where YNAB mapped Date, Payee, Memo, Outflow and Inflow from our headers on its own and only asked to confirm MM/DD/YYYY; the preview was cancelled, so nothing changed in YNAB. Save a copy… is the raw SQLite copy. Backups: keep 3 to 100 open backups, choose the folder (a setting of this PC in the app's data folder, never in the plan), Back up now, and restore from the list. Smoke: export lands as a zip with both files; Back up now and the keep setting survive a relaunch.
- Excel isn't installed on the dev machine (only Office 2016 update leftovers; no EXCEL.EXE). Exports were checked with a strict CSV parser (BOM, quoting, equal row widths), against YNAB's own files, and **in OpenOffice Calc 4.1.2** (2026-10-09, headless through UNO): the Reflect exports and the YNAB-format Plan and Register, for a US plan (CSV) and a euro plan (decimal comma, DD.MM.YYYY, € after; TSV), with accents, commas, quotes and line breaks in names and memos. All 12 files, 5,234 cells: every amount is a number with the exact value, every date a date, every text cell exact, the BOM consumed. In a German locale Calc turns the month headers "Aug 2026" and "Sep 2026" into dates; YNAB's files use the same headers, so they behave the same. Sarg accepted this Calc check as the exit check (2026-10-09).

## Phase 7: Professional polish & remaining parity

| Sprint | Scope | Done when |
|---|---|---|
| **S7.1 Settings** | Currency (ISO 4217, decimals), number and date formats, first month, theme (light/dark/system/high contrast), font scale, default account, data folder, shortcuts on/off, **Hide Amounts**. | Every setting takes effect live and persists per file or per device as appropriate. |
| **S7.2 Multiple plans & lifecycle** | Open/recent list; new-plan wizard (blank / **template** / import from YNAB); **Fresh Start** (D12); templates as bundled JSON where the user picks categories to import. | A new user can start three ways; Fresh Start keeps what YNAB keeps. |
| **S7.3 Keyboard completeness** | Every published YNAB shortcut plus Windows conventions; `?` overlay; shortcut hints in menus and tooltips. | Shortcut table in docs; every entry tested. |
| **S7.4 Accessibility** | Narrator and NVDA pass on Plan, Register and Reflect; ARIA grid; visible focus; high-contrast mode; differentiate-without-color; reduced motion; keyboard-only complete workflows. Target WCAG 2.2 AA. | Audit doc with zero open AA issues. |
| **S7.5 Onboarding & empty states** | First run with **Import from YNAB** as the hero path; resumable setup checklist; designed empty states for every screen; in-app help; copy review of all errors and confirmations. | A fresh user reaches a working plan in < 10 minutes (tested with someone other than Sarg). |
| **S7.6 Attachments & leftovers** (ADR) | Transaction photos stored **inside the .hafb** (BLOBs keep the single-file promise), thumbnails and viewer; any remaining parity rows. | Parity checklist has no `todo` left outside Phase 8. |
| **S7.7 Visual & interaction polish** | Consistency audit (spacing, type, color, icons), motion and micro-interactions, density tuning, dark-mode review, high DPI 100–200%, multi-monitor and snap; full design critique pass. | Sarg's design sign-off. |

Progress (YNAB used as the reference throughout, 2026-10-09; it was put back as it was after every probe):
- **S7.1 done in code.** Plan Settings in the plan menu is YNAB's dialog: Plan Name, Currency ("Name–CODE", 160 currencies; picking one fills YNAB's placement and number format for it, e.g. SEK "123.456,78kr", INR "1,23,456.78", CHF "123'456.78", KWD three decimals), Currency Placement (before, after, don't show), Number Format (YNAB's eight, shown in the currency's decimals) and Date Format (YNAB's seven). In YNAB, switching a plan to yen showed $3,070.00 as ¥3,070 and $370.01 as ¥370, and switching back brought the cents back, so HAFB keeps every stored amount and only changes the decimals shown (migration 0004 `plan.display_decimals`). A symbol after the amount has no space, as in YNAB. Display Options is YNAB's dialog (Theme, Progress Bars, Balance Style; HAFB adds High contrast). Preferences holds this PC's settings: text size 90–150% (the whole window zooms; Ctrl+= / Ctrl+- / Ctrl+0), keyboard shortcuts, Hide Amounts, the default account for new transactions and imports in All Accounts (per plan) and the plans folder the Open and Save dialogs start in. New Plan uses the same dialog as YNAB's ("Create Plan"). A store test now keeps the Rust contract fixtures in step with the codec (`HAFB_WRITE_FIXTURES=1` rewrites them).
- **S7.2 done in code.** New Plan is YNAB's dialog plus "Start with" (a blank plan or one of 12 bundled templates) and "Import your YNAB export instead". Add categories from a template (plan menu) is YNAB's Import Category Template dialog: pick a template, untick categories, and the new groups go at the bottom without touching anything; amounts become "Have a balance of" targets with no date, as YNAB's did in the trial. Make a Fresh Start is YNAB's dialog: the new plan is a new file with the open accounts at $0 today, the groups, categories, targets, scheduled transactions, payees and expected income; this file stays, renamed "(Archived on …)" with its history (YNAB keeps archived plans editable, so HAFB does too; CLAUDE.md §5.14 corrected). After a YNAB import, Add targets offers a target choice and amount per category, prefilled with the three-month average assigned, saved as one undo step. The plan menu lists the five most recent plans. Smoke: Plan Settings and text size survive a relaunch; template import; New Plan from a template; Fresh Start writes the new file and archives the old one (`HAFB_SAVE_DIR` replaces the Save dialog in tests).
- **S7.3 done in code.** Every shortcut on YNAB's help page and in its in-app Keyboard Shortcuts dialog (2026-10-09) works in HAFB. A test checks each listed shortcut is registered with exactly those keys, or handled in a component whose test file covers it, and that `docs/shortcuts.md` (generated from the list) is current. Windows conventions added: F1 (shortcut list), Ctrl+N (new plan), Ctrl+O (open plan), Ctrl+comma (Preferences); text size keys from S7.1. A release-app smoke test checks they do HAFB's thing and not WebView2's (Ctrl+N opens no browser window; Ctrl+= is one 110% step). Shortcut hints are in the plan, register and context menus and on toolbar buttons.
- **S7.4 done in code.** `docs/accessibility.md` lists every WCAG 2.2 A/AA criterion as pass or not applicable, with evidence. Checks run:
  - axe-core (development dependency only) on every screen, dialog and open state in light, dark and high contrast; a release-app smoke test reruns it.
  - The release app's UI Automation tree (what Narrator reads): no unnamed controls on screen. NVDA isn't installed on the test PC.
  - Keyboard-only smoke tests.
  - Emulated Windows contrast themes.
  - 200% text in a 1280×720 window, the 1.4.12 text-spacing overrides, and focus versus the sticky header.

  Fixes:
  - 24 px targets (WCAG 2.5.8).
  - A click on a resize handle offers Narrower / Wider / Reset width (2.5.7).
  - The register's editing panel is now a grid cell (ARIA).
  - Readable dimmed keys in the `?` list.
  - Filled elements keep their text in contrast themes.
  - Text size up to 200%.
  - Below 1024 CSS px the sidebar becomes its rail, and below 900 px the inspector opens over the plan from Display options.
- **S7.5 done in code.**
  - **Onboarding:** the welcome screen leads with Import YNAB export and the developer links are gone from release builds. New Plan starts blank or from a template, or imports instead.
  - **Get started card:** at the top of the inspector, five steps (accounts, categories, assign, a target, a transaction). They're read from the plan itself, so the list resumes after a restart with nothing stored in the file. Each open step has a button that does it, and the card can be hidden.
  - **Empty states:** a plan without categories offers Use a template or Add a category group; a register with no accounts offers Add Account; Net Worth without accounts says so. Reflect's empty states became the shared `EmptyState` component.
  - **Help (plan menu):** ten short topics in YNAB's vocabulary, bundled with the app so they work offline, with a button to the shortcut list.
  - **Copy review:** every store error and app notification was reviewed. Fixes: a split mismatch now says "$12.34, not $15.00" rather than minor units, apostrophes are consistent, and every message ends with a full stop.
  - **Smoke test:** from the welcome screen, a new user makes a plan from a template, adds an account, records a transaction and assigns money, in under 10 minutes, and the card reads "You're all set". Sarg waived the human check (a fresh user other than Sarg) on 2026-10-09 in favour of this smoke test.
- **S7.6 done in code.**
  - **Transaction photos (ADR 0009),** as in YNAB's trial (2026-10-09):
    - A photo column after the flag; one image per transaction.
    - A viewer with Delete Image (confirmed), Download Image and Close.
    - The photo is stored as a BLOB inside the .hafb with a ~10 KB thumbnail made in the webview (migration 0005), so backups and Save a copy carry photos.
  - **Credit Card Interest (CC-07),** behind a Preferences switch that is off by default:
    - Card registers offer the category; the interest stays off the plan and shows as card debt in the payment category; the Activity popover lists it.
    - Modeled from YNAB's 2026-10-07 announcement, because the trial account doesn't have the feature yet. The open assumptions are in budget-math §3.15 and §13 Q10.
    - Migration 0006 adds its system category row.
  - **Legacy goal mapping (T-10):** `legacyTarget` turns YNAB's old goal types (TB, TBD, MF, NEED, DEBT, with their cadences) into current targets (budget-math §6.10). YNAB's CSV export has no targets, so the S7.2 re-entry screen remains the import path.
  - **Available pills (P-09):** checked complete and marked done.
  - **Exit check:** the parity checklist has no `todo` left outside Phase 8, apart from X-02 (high DPI), which is S7.7's.
  - **Smoke tests:** photo, and Credit Card Interest end to end in the release app.
- **S7.7 done, design signed off by Sarg 2026-10-09.** It was an audit, not a restyle: the approved look is unchanged.
  - **Consistency:** colours, sizes, radii and durations were already token-only (`sourceScan`). Every UI icon goes through `Icon`; the only inline SVGs are charts. Plan rows are ~34 px and register rows ~30 px.
  - **Photo column:** an empty cell now shows its button only on row hover or keyboard focus, like the flag column; attached thumbnails always show. Button size 26 px, matching the flag button.
  - **Motion:** two durations in use, 120 ms and 180 ms, both tokens. Under reduced motion, nothing transitions or animates (checked in the browser).
  - **Dark mode and high DPI:**
    - Every main screen and dialog was screenshotted at 100%, 150% and 200%, in light and dark. A DOM scan found no clipped text and nothing past the window edge.
    - The release app ran at WebView2 forced scale factors 1.25, 1.5 and 2: the caption buttons stay 46×32, and the page never scrolls sideways (down to an effective 640×410).
  - **Multi-monitor and snap (the release app, on this PC's two 1920×1080 monitors):**
    - Closed on the second monitor, it reopens there. With that monitor gone from the saved state, it comes back centred on the primary.
    - Win+Left snaps to the left half; Win+Up then makes the top-left quarter, as Windows 11 does.
    - Mixed-DPI monitors weren't available here.
  - **Fixes:**
    - The last grid column's resize handle overhung the grid by 3 px, so the plan grid scrolled sideways at every size. A smoke test now guards it.
    - Below 1024 px (a half-screen snap), the plan's money columns are 100 px and the category column 160 px, so the grid fits beside the inspector.
    - The register still scrolls sideways at half-screen width; data tables are exempt from reflow (WCAG 1.4.10) and its columns stay reachable.

## Phase 8: Release hardening → **v1.0**

| Sprint | Scope | Done when |
|---|---|---|
| **S8.1 Performance at scale** | Launch to usable plan < 1.5 s on a 2019-era laptop with 20k transactions; recompute < 50 ms (5y × 100 categories); register at 60 fps and on 120/144 Hz; memory budget; profiling fixes. | All CLAUDE.md §8 budgets met on hardware. |
| **S8.2 Reliability & data safety** | Property-based engine tests; upgrade tests from every prior schema; power-loss/WAL tests; corruption detection and recovery; backup-restore drills; very large files. | No data-loss path found. |
| **S8.3 Privacy audit** | Resolve the WebView2 **Crashpad** / diagnostic-data question (ADR 0001 open item); firewall-verified zero connections (app and installer); the bank-sync check (only the SimpleFIN host, ADR 0006) is repeated in S8.6, which comes after; dependency license and network audit; CSP review. | Written privacy statement backed by evidence. |
| **S8.4 Packaging** | Versioning, MSI upgrade path (stable upgrade code), portable-mode data location, uninstall keeps data, ARM64 build (nice-to-have); document SmartScreen behavior for unsigned builds. | Upgrade from the previous build keeps every file intact. |
| **S8.5 Docs & beta** | User guide, YNAB migration guide, shortcut reference; beta with a few YNAB users; final parity audit against `ynab-parity.md`. | Beta feedback triaged; the parity audit has only S8.6 rows open. |
| **S8.6 Bank sync, optional** (ADR 0006; the very last item before v1.0) | SimpleFIN Bridge: paste a setup token, claim it, and keep the access URL in Windows Credential Manager (never in the plan). Map SimpleFIN accounts to HAFB accounts (new migration). Sync on open, about every 6 hours while open (random minute), and *Sync now*. Fetch window = last sync minus 5 days, capped at 90 days. Results feed the S6.5 pipeline (unapproved, auto-match, rename rules, RejectedImport). Unlink deletes the secret. One Rust HTTP client (rustls). | Sarg's Regions accounts sync with zero duplicates across repeated syncs and alongside file imports. A firewall log shows zero connections with sync off and only the SimpleFIN host with it on. Every non-server parity row is `done`; then **v1.0** is tagged. |

Progress:
- **S8.1 done in code (2026-10-10).** All measurements use the release app with a generated 20,000-transaction plan (`smoke/largePlan.ts`): five years, 100 categories, three cards, two loans, splits, transfers and targets.
  - **Hardware:** this PC (Ryzen 7 5700X), plus an emulated 2019 laptop. For the laptop, the power plan's maximum processor state was set to 70%, about 1.65× slower per thread, and put back afterwards.

  | Budget (CLAUDE.md §8) | Before | This PC | Emulated 2019 laptop |
  |---|---|---|---|
  | Launch to a usable plan < 1.5 s | 1.39–1.49 s | 0.77–0.98 s | 1.42–1.47 s (the very first launch, which builds the WebView2 profile, 1.76 s) |
  | One recompute < 50 ms (5 years × 100 categories) | ~21 ms warm, ~40 ms cold | 13 ms warm, ~30 ms cold | 22 ms warm |
  | Register scroll at 60 fps | 0 missed | 0 missed (3,000 px/s) | 0 missed |

  - **120/144 Hz:** no high-refresh screen is available here. Scrolling the register costs 5.3 ms of main-thread work per frame on average (p95 task 5.6 ms, longest 7.8 ms). That fits 120 Hz (8.3 ms per frame) and just fits 144 Hz (6.9 ms).
  - **Memory:** with the 20k plan open, the app (hafb.exe and its WebView2 processes) uses 470–515 MB working set, against 410–430 MB for the small sample plan. The plan adds under 100 MB; the JS heap is about 34 MB. Most of the rest is WebView2's own.
  - **Interactions:** assigning a category takes about 70 ms from keypress to paint on this PC and about 100 ms on the emulated laptop.
  - **Fixes:**
    - The launch plan (`--open`) is opened and serialized by Rust on a worker thread while WebView2 starts, and the UI requests it before React's first render.
    - The backup on open (VACUUM INTO, 330 ms on a 10 MB plan) no longer delays opening. It runs right after the first load and always before the first write (`OpenPlan::writable`). If it fails, nothing is written.
    - Posting loan charges on open rescanned every transaction once per month of history (240 ms). Now it scans once.
    - `keyOf` no longer copies each record to read its key. `Draft.all` uses the cached key index.
    - `planBudget` makes one computation through next month. The plain state, this month's and next month's are exact cuts of it (`budgetThrough`, `BudgetState.dataThrough`), so an edit costs one computation where it used to cost three.
    - The engine's hot loop: no per-transaction line copies, months cached per date, card outflows gathered only for overspent categories.
    - The store returns rows in key order.
  - **Smoke test:** a 20k-transaction plan opens at launch, ready to use, within 1.5 s, and its register scrolls with at most 2 missed frames. `window.hafbOpenTiming` gives the breakdown: open, load, decode, compute, ready.
  - **Not done, by choice:** a smaller load format and decode or bundle rework. The budgets are met, and slow hardware is the uncommon case (Sarg, 2026-10-10).
  - **For S8.2:** a process killed during the backup on open can leave a partial `open-…` file in the backups folder. This is unchanged from before; the plan itself is untouched.

## Out of scope (wontfix; server-dependent)

YNAB's Direct Import providers (Plaid, MX, TrueLayer, Apple Card; HAFB's optional bank sync uses SimpleFIN instead, S8.6), pending transactions, institution logos, retailer order-history links, YNAB Together (members, avatars, "who moved it"), the "For You" content feed, API / Zapier / widgets / Siri / Watch, mobile apps and mobile-only screens, referrals and gifts, Mint migration, template sharing by link. The engine stays portable so a mobile or web app is possible later.
