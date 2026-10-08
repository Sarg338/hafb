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
  - Upcoming: undo/command architecture (S2.3), styling approach (S3.2), charting (S6.1), attachment storage (S7.6).
- **Look and feel:** we use YNAB's *vocabulary and interaction patterns* (CLAUDE.md §9). We do **not** copy YNAB's branding, illustrations or visual trade dress. HAFB gets its own Windows-native visual identity.

## Milestones

| Milestone | When | Meaning |
|---|---|---|
| **M0 – Stack validated** | Phase 0 ✅ | Tauri 2 + React + SQLite proven on hardware. |
| **M1 – Daily driver** | end of Phase 4 | Sarg runs his real budget in HAFB alongside YNAB for 2 weeks and the numbers match to the cent. |
| **M2 – Planning parity** | end of Phase 5 | Targets, auto-assign, scheduled, payees and reconcile. A full monthly workflow is possible without YNAB. |
| **M3 – Feature parity** | end of Phase 6 | Every non-server row in `ynab-parity.md` is `done`. |
| **v1.0** | end of Phase 8 | Professional polish, accessibility, performance at scale, privacy audit, installer, docs, beta. |

## Inputs needed from Sarg (blocking dates)

| Needed by | Input |
|---|---|
| — | ~~Sarg's own YNAB export~~: **Sarg has no YNAB account.** Golden data comes from a public real export kept local-only (`packages/engine/test/fixtures/local/`, git-ignored, never committed), plus optionally a YNAB free-trial scenario (below). |
| S1.7 (optional) | A **YNAB free-trial scenario**: we write a scripted month of transactions covering splits, targets, credit overspending, future assignments and loans. Sarg enters it in a YNAB trial, exports it, and screenshots the open items (D7, D11, D12). This is the only way to verify those items and to get splits and targets into a golden file; the public sample has neither. |
| S6.5 | Sample bank files: OFX/QFX, QIF and CSV from your banks. |
| S8.1 | Access to a slower (2019-era) Windows laptop for the launch-time budget, or agreement to throttle the CPU instead. |

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

| Sprint | Scope | Done when |
|---|---|---|
| **S2.1 Schema v1** | `0001_init.sql` from the amended §4: soft deletes, `approved`/import fields (D4), starred accounts, focused views, payee auto-categorize settings, expected income, the split-sum trigger. Rust migration runner with **automatic pre-migration backup**; WAL; `cargo test` for migrations. | Fresh and migrated files pass the schema tests. |
| **S2.2 Data access** | Thin, typed Rust commands: a snapshot load (fast path for 20k+ transactions) and batched mutations in one SQLite transaction. TS bindings in `@hafb/shared`. | Snapshot of a 20k-transaction file loads in < 300 ms on Sarg's PC. |
| **S2.3 Commands & undo** (ADR) | Command objects with inverses; multi-change commands (e.g. auto-assign) as one undo step; session command log persisted; feeds Recent Moves; engine result caching and invalidation; Zustand store wiring. | Property test: any command sequence followed by full undo restores the starting snapshot. |
| **S2.4 YNAB import** | `pnpm import:ynab <zip> <out.hafb>`: plan history, register, transfers, splits, CC payment categories, flags, cleared state; targets gap documented with a re-entry list. | Imported file reproduces Sarg's YNAB numbers (S1.8 golden). |
| **S2.5 Budget files** | Create, open and recent files; single-writer lock; auto backups on open (keep N); restore; "save a copy". Retire the Phase 0 SQLite spike. | Sarg opens his imported file from the app on hardware. |

## Phase 3: Design system & app shell (the "professional" foundation)

**Goal:** a cohesive, Windows-native design language and the reusable pieces every screen is built from, *before* building screens.

| Sprint | Scope | Done when |
|---|---|---|
| **S3.1 Design direction** | Information architecture (Plan / Reflect / Accounts, sidebar, inspector). HAFB visual identity, Fluent-aligned, Segoe UI Variable. Density spec (34 px plan rows, 30 px register rows). Type scale with tabular numerals. Color system for light, dark and **high contrast**, with semantic status colors (funded/underfunded/overspent/snoozed) and a **"differentiate without color"** alternative. Clickable mockups of Plan, Register, Inspector and Reflect. | Sarg approves the mockups; a design spec doc is committed. |
| **S3.2 Tokens & primitives** (ADR: CSS modules vs vanilla-extract) | Design tokens; button, icon button, text and **money input with math** (+ − × ÷), date picker with YNAB keys (+/−, T, M, Y), grouped searchable **combobox** (payees, categories), checkbox, toggle, segmented control, chips, menu and **context menu**, popover, dialog, **toast with Undo**, tooltip with shortcut hints, segmented progress bar, progress ring. Dev-only component gallery route. | Gallery reviewed on hardware at 100%, 150% and 200% scale, light/dark/high contrast. |
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

## Phase 6: Reflect, loans, data in/out → **M3**

| Sprint | Scope | Done when |
|---|---|---|
| **S6.1 Reflect framework** (ADR: charts) | Choose charting (hand-rolled SVG vs a library; must pass the no-network audit). Reflect shell with 5 tabs; category and account tree pickers (Select All/None); timeframe presets and custom range with previous/next; summary side panel; drill-down transaction modal; export CSV/TSV and PNG. | Filters persist; exports open correctly in Excel. |
| **S6.2 Spending Breakdown & Trends** | Donut by group/category, stack-ranked list, positive-inflow section; stacked bars over time with average line; Totals/Trends toggle. | Matches YNAB for the same filters on Sarg's data. |
| **S6.3 Net Worth, Income v Expense, Age of Money** | Assets vs debts bars with net worth line; collapsible income/expense table with average and total; Age of Money chart (6m/1y/2y) with its < 10 outflows empty state; **Share Your Progress** PNG (amounts hidden). | Numbers tie to the engine; the PNG renders at high DPI. |
| **S6.4 Loans & loan planner** | Loan setup (rate, escrow, fees, minimum payment, original principal), monthly interest posting (editable), paired category with Record Payment and Monthly Debt Payment target, payoff calculator (payment ↔ payoff date), what-if extra payments, payoff celebration. | Matches Sarg's actual loan statement within a documented tolerance. |
| **S6.5 Bank file import** | CSV (column mapper remembered per account, date-format detection, swap inflow/outflow, semicolons), OFX/QFX (multi-file), QIF. Dedupe by FITID plus fuzzy match. Approve/reject/match/unmatch review (D4); auto-match to entered and scheduled transactions (≤ 10 days); CC payment pairing; skip rule (D13); rename rules applied; inflows default to Ready to Assign. | Sarg's real bank files import with zero duplicates on re-import. |
| **S6.6 Export & backups + M3** | YNAB-format CSV export (verified to import back into YNAB); raw SQLite copy; backup settings (count, location) and restore UI. | **M3:** every non-server parity row is `done`. |

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

## Phase 8: Release hardening → **v1.0**

| Sprint | Scope | Done when |
|---|---|---|
| **S8.1 Performance at scale** | Launch to usable plan < 1.5 s on a 2019-era laptop with 20k transactions; recompute < 50 ms (5y × 100 categories); register at 60 fps and on 120/144 Hz; memory budget; profiling fixes. | All CLAUDE.md §8 budgets met on hardware. |
| **S8.2 Reliability & data safety** | Property-based engine tests; upgrade tests from every prior schema; power-loss/WAL tests; corruption detection and recovery; backup-restore drills; very large files. | No data-loss path found. |
| **S8.3 Privacy audit** | Resolve the WebView2 **Crashpad** / diagnostic-data question (ADR 0001 open item); firewall-verified zero connections (app and installer); dependency license and network audit; CSP review. | Written privacy statement backed by evidence. |
| **S8.4 Packaging** | Versioning, MSI upgrade path (stable upgrade code), portable-mode data location, uninstall keeps data, ARM64 build (nice-to-have); document SmartScreen behavior for unsigned builds. | Upgrade from the previous build keeps every file intact. |
| **S8.5 Docs, beta, v1.0** | User guide, YNAB migration guide, shortcut reference; beta with a few YNAB users; final parity audit against `ynab-parity.md`. | **v1.0** tagged. |

## Out of scope (wontfix; server-dependent)

Direct Import / bank sync (Plaid, MX, TrueLayer, Apple Card), pending transactions, institution logos, retailer order-history links, YNAB Together (members, avatars, "who moved it"), the "For You" content feed, API / Zapier / widgets / Siri / Watch, mobile apps and mobile-only screens, referrals and gifts, Mint migration, template sharing by link. The engine stays portable so a mobile or web app is possible later.
