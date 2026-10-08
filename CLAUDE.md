# HAFB — Here's A Free Budget

Free, local-only, native Windows envelope-budgeting app. Target: **complete feature parity with YNAB** (the web/desktop product as of 2026), minus anything that requires YNAB's servers (bank sync, shared-budget cloud sync, mobile apps).

This file is the durable source of truth for the project. Read it fully before doing anything. Update it when a decision is made or a phase completes — stale CLAUDE.md is worse than none.

---

## 1. Non-negotiables

- **Local-only.** No network calls, ever. No telemetry, no crash reporting, no update checks, no analytics. The app must work with the network cable unplugged and must never ask for an account. If a library phones home, it is not allowed in.
- **Free.** No paywalls, no "pro" tier, no nag screens. MIT license.
- **The user's data is a single file they own.** One SQLite file per budget, in a user-chosen location, human-inspectable with any SQLite tool. Users can put it in a OneDrive/Syncthing folder if they want "sync" — we do not build sync.
- **Money is never a float.** All amounts are 64-bit integers in minor units (cents for USD). Currency decimal places come from the budget's currency setting. Division only happens in auto-assign/averaging, and rounding rules must be explicit and tested.
- **Budget math is the product.** Every rule in §5 has unit tests before it has UI. Never "fix" math in the UI layer.
- **Native Windows.** Windows 10 22H2+ and Windows 11, x64 (ARM64 nice-to-have). Keyboard-first, fast, looks like it belongs on the OS. Not a browser tab in a frame.
- **Nothing is done until it runs on the real machine.** Sarg validates on actual hardware. "It should work" is not a status.

---

## 2. Tech stack

**Status: DECIDED — 2026-10-08.** The Phase 0 spike passed on Sarg's machine: 50k-row grid at 60 fps with 0 missed frames, launch ≈ 500 ms, snap layouts working, no network activity, 2.25 MB `.msi`. Details and the pinned versions are in `docs/decisions/0001-stack.md`.
- **Storage:** `rusqlite` (bundled) behind Tauri commands; `tauri-plugin-sql` was rejected.
- **Title bar:** custom, via `tauri-plugin-frame` =1.1.8 (source audited); the native title bar is a tested fallback.
- **TypeScript 6.0.3, not 7:** typescript-eslint doesn't support 7 yet.
- **WinUI 3:** a head-to-head spike was started, then dropped at Sarg's direction because it was too fiddly to build. Its findings are in the ADR.

**Default stack:**
- **Shell:** Tauri 2 (Rust core, WebView2 renderer — WebView2 ships with Windows 11 and is an evergreen runtime on Windows 10). Small binary, real native window, no bundled Chromium.
- **UI:** React 19 + TypeScript (strict). State via Zustand. Styling with CSS modules or vanilla-extract — no Tailwind in this project (density matters; utility classes fight tabular UI).
- **Grid:** TanStack Table for the register and budget sheet. Virtualized. Must handle 50k+ transactions without jank.
- **Storage:** SQLite via `tauri-plugin-sql` (sqlx under the hood) **or** `rusqlite` behind Tauri commands. Spike decides. WAL mode. Migrations via numbered SQL files, applied on open, never edited after shipping.
- **Budget engine:** Pure TypeScript package (`packages/engine`), zero dependencies on Tauri/DOM. It takes a snapshot of data in, returns computed budget state out. This is what gets tested exhaustively, and it is what makes a future Android/web port possible.
- **Tests:** Vitest for engine + UI logic. Playwright (via Tauri's WebDriver support) for a small smoke suite. Rust: `cargo test` for commands.
- **Packaging:** Tauri bundler → `.msi` and portable `.exe`. Code signing is out of scope for now.

**Rejected alternatives (and why):**
- Electron — 150 MB+ install, bundled Chromium, feels non-native. Only reconsider if WebView2 proves incapable.
- WinUI 3 / .NET — truest "native" option, but Sarg's primary stack is TypeScript, and the engine would have to be written in C#, killing portability. Reconsider only if the WebView2 UI cannot hit the density/perf bar.
- Flutter — fine, but Dart isn't in the stack and desktop Flutter still has text-input rough edges.

---

## 3. Repository layout

```
hafb/
  CLAUDE.md                  ← this file
  README.md
  docs/
    decisions/               ← ADRs, one file per decision (NNNN-title.md)
    ynab-parity.md           ← the parity checklist (§6), kept current
    budget-math.md           ← worked examples for every rule in §5
  packages/
    engine/                  ← pure TS budget engine (no I/O, no DOM, no Tauri)
      src/
      test/
        fixtures/            ← YNAB export CSVs + expected outputs (golden tests)
    shared/                  ← types shared between engine, UI, and Rust bindings
  apps/
    desktop/                 ← Tauri app
      src/                   ← React UI
      src-tauri/             ← Rust: window, SQLite commands, file dialogs
        migrations/          ← 0001_init.sql, 0002_... never edited after merge
  scripts/
    import-ynab.ts           ← YNAB export → HAFB SQLite (also exposed in-app)
```

Monorepo with pnpm workspaces. `packages/engine` must never import from `apps/`.

---

## 4. Domain model

Entities (table ≈ TS type ≈ Rust struct; keep them in lockstep via `packages/shared`):

- **Budget** — name, currency (ISO 4217), decimal digits, date format, number format, first month, settings. One SQLite file = one Budget.
- **Account** — name, type, `on_budget: bool`, `closed: bool`, note, sort order, last reconciled at.
  - Budget account types: `checking`, `savings`, `cash`, `credit_card`, `line_of_credit`.
  - Tracking account types: `asset`, `liability`, `mortgage`, `auto_loan`, `student_loan`, `personal_loan`, `medical_debt`, `other_debt`.
  - Loan accounts additionally carry: interest rate (bps), escrow amount, minimum payment, original principal, payment schedule.
- **CategoryGroup** — name, hidden, sort order, `is_system` (for the two system groups: *Credit Card Payments* and *Hidden Categories*; plus the implicit *Inflow* group that holds *Ready to Assign*).
- **Category** — group, name, hidden, note, sort order, `credit_card_account_id` (set only for CC payment categories).
- **Target** (category goal) — one per category, see §5.4 for types.
- **Payee** — name, `transfer_account_id` (payees for transfers are system-managed), default category, note, deleted.
- **PayeeRenameRule** — pattern (contains / starts with / equals, case-insensitive), target payee.
- **Transaction** — account, date, payee, category (nullable for transfers to/from on-budget accounts and for tracking accounts), memo, amount (signed minor units; negative = outflow), `cleared: uncleared | cleared | reconciled`, flag color (nullable), `transfer_transaction_id` (the paired leg), `scheduled_transaction_id` (origin, if any), import id, deleted.
- **Subtransaction** — parent transaction, category, payee (optional override), memo, amount, transfer leg. Parent amount must equal sum of subtransactions (invariant, enforced in engine and DB trigger).
- **ScheduledTransaction** — everything a Transaction has, plus frequency (`never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear`) and `next_date`. Scheduled sub-transactions too.
- **MonthCategory** — (month, category) → `assigned` minor units. This is the only user-entered budget number. `activity` and `available` are always derived, never stored as authoritative (they may be cached with an invalidation key).
- **MonthNote**, **CategoryNote** — free text.
- **Reconciliation** — account, date, statement balance, adjustment transaction id.

Soft deletes everywhere (`deleted_at`). Every mutating action goes through a command object so undo/redo (§6.9) is a replay of inverse commands.

IDs: UUIDv7 (time-sortable, generated client-side).

---

## 5. Budget math — the rules

These are the YNAB semantics HAFB must reproduce exactly. Each rule gets worked examples in `docs/budget-math.md` and a test in `packages/engine/test/`. Month boundaries are calendar months in the budget's local date (no time zones — dates are `YYYY-MM-DD` strings).

### 5.1 Core identity
For each category and month:
```
available(m) = available(m-1)_carried + assigned(m) + activity(m)
```
- `activity(m)` = sum of transaction amounts in month `m` categorized to this category (outflows negative), across all **on-budget** accounts. Transactions in tracking accounts never touch categories.
- `available(m-1)_carried`:
  - if `available(m-1) >= 0` → carries forward in full.
  - if `available(m-1) < 0` and the overspending is **cash** → carries as `0`; the shortfall reduces next month's Ready to Assign (see 5.3).
  - if `available(m-1) < 0` and the overspending is **credit** → carries forward as the negative amount (the category stays red until covered). YNAB calls this "credit overspending."
- A month's overspending is classified as **cash** if the net category overspending is covered by cash-account outflows, otherwise **credit**. Precisely: for the month, compute the category's outflows from credit accounts vs. cash accounts; overspending is attributed to credit first up to the credit outflow total, remainder is cash. Document and test the edge case where both exist.

### 5.2 Ready to Assign (RTA)
```
RTA(m) = RTA(m-1)
       + inflows to "Inflow: Ready to Assign" in month m (on-budget accounts only)
       - sum of assigned(m) across all categories
       - cash overspending from (m-1)   [see 5.1]
       + (assigned in future months is NOT subtracted here — see 5.2.1)
```
- RTA can go negative; UI shows it red with "You assigned more than you have."
- **5.2.1 Future months:** money assigned in a future month reduces RTA *in that future month and all months after it*, and YNAB also shows it as "Assigned in Future" in the current month's RTA breakdown, reducing the headline RTA number. Reproduce the breakdown popover: *Left over from last month / Assigned this month / Inflow this month / Assigned in future*.
- **Starting balances** of on-budget accounts are inflows to RTA (or outflows for a negative starting balance on a CC) dated to the account's start date.

### 5.3 Credit cards
- Creating a credit card account creates a hidden-from-user-deletion category *"<Card Name>"* in the *Credit Card Payments* group, linked via `credit_card_account_id`.
- A categorized outflow on a credit card account moves money: category available decreases by the amount, **and** the CC payment category available increases by the same amount — but only up to the amount the category actually had. If the category was already at 0 or would go negative, the uncovered portion does **not** move to the payment category (this is the mechanism behind credit overspending).
- A transfer from a cash account to the CC account is a payment: it reduces the CC payment category's available by the payment amount and does not touch any other category.
- Inflows (refunds) categorized on a CC account reverse the movement.
- Interest/fees charged on the card are regular categorized outflows on the card (user categorizes them, usually to a "Interest & Fees" category).
- The CC payment category's *available* is how much cash is set aside to pay the card. Account balance vs. available = the "pay in full" gap. Show it.

### 5.4 Targets
Types, each with a `due` or a cadence:
1. **Needed for Spending** — `weekly` (by weekday), `monthly` (by day-of-month), `yearly` (by date), or `custom` (amount by a date, with/without repeat). Two refill modes: *Refill up to* (fund to the target amount) and *Set aside another* (add the target amount regardless of current available).
2. **Savings Balance** — *By date* (reach balance X by date Y; underfunded = evenly spread remaining amount over remaining months, including this one) or *No date* (just reach X).
3. **Monthly Savings Builder** — assign X every month.
4. **Have a Balance of** — (YNAB's "Savings Balance, no date" in older naming; keep as alias for import).

Computed per (category, month): `target_amount`, `underfunded` (what you'd need to assign now to be on track), `funded`, `status` (`on_track | underfunded | funded | overspent | snoozed`), and the "Spending" vs "Savings" progress bar semantics (spending targets show *spent* progress for the period; savings targets show *available* vs *goal*).
- **Snooze** — a target can be snoozed for the current month; underfunded = 0 that month, status = snoozed.
- Targets with a due date in the past and `repeat` off become inactive after the due month.

### 5.5 Auto-assign
Buttons on the budget sheet (apply to selected categories or all visible):
`Underfunded`, `Assigned Last Month`, `Spent Last Month`, `Average Assigned` (last 12 months), `Average Spent` (last 12 months), `Reset Available Amounts` (assign so available = 0), `Reset Assigned Amounts` (set assigned to 0).
Each shows a preview total before committing. Averages use integer division with round-half-up to the currency's minor unit. All auto-assign actions are one undo step.

### 5.6 Move money / cover overspending
Move between any two categories (or RTA) within a month: `assigned` changes on both sides, net zero. "Cover overspending" is the same thing with a pre-filled amount.

### 5.7 Age of Money
YNAB's definition: for each outflow (on-budget, non-transfer, cash accounts only), find how old the dollars spent are by FIFO-matching against inflows to RTA. Age of Money shown in the header = the average age across the last 10 outflows. Reproduce their FIFO exactly; there is a well-known community write-up — read it, encode it in `docs/budget-math.md` with examples, and test it.

### 5.8 Reconciliation
Enter statement balance → engine computes the difference between the **cleared** balance and the statement. If zero, mark all cleared transactions as reconciled. If not, offer to create an adjustment transaction (payee *"Reconciliation Balance Adjustment"*, categorized to RTA for on-budget accounts, uncategorized for tracking) then reconcile. Reconciled transactions warn on edit; editing one unlocks only that transaction.

### 5.9 Transfers
- On-budget ↔ on-budget: no category on either leg; no budget impact.
- On-budget → tracking (e.g. paying a mortgage from checking): the on-budget leg **does** get a category (it's spending from the budget's perspective); the tracking leg has none.
- Tracking → on-budget: the on-budget leg is an inflow to RTA (or any category).
- Both legs share a `transfer_group`; editing amount/date on one leg updates the other. Deleting one deletes both.

### 5.10 Loan accounts
Tracking accounts with interest. Each month, generate an interest transaction (`payee: Interest`) based on rate × balance (simple monthly accrual to start; document the formula YNAB uses and match it). Support "Loan Planner": what-if extra-payment simulations showing payoff date and interest saved. Escrow is tracked as a separate running amount that doesn't affect principal.

---

## 6. Feature parity checklist

Full tracked list lives in `docs/ynab-parity.md` with status per item (`todo | in-progress | done | wontfix`). Summary by area, in build order:

1. **Budget core** — categories/groups (add, rename, reorder via drag, hide/unhide, delete with reassignment), month navigation, assign, available, RTA with breakdown, overspending (cash + credit), move money, cover overspending, month notes, category notes, "Fresh Start" (new budget seeded from current categories/accounts with starting balances).
2. **Accounts** — all account types above, add/edit/close/reopen, starting balance flow, reorder, account notes, on-budget/tracking sections in sidebar with totals, working balance / cleared balance / uncleared balance header.
3. **Register** — add/edit/delete, inline editing (keyboard: Enter commits, Tab moves, Esc cancels, Ctrl+Enter save-and-add-another), split transactions with "remaining" helper, transfers with payee picker, flags (6 colors + custom names), cleared toggle with click cycling, memo, running balance column (optional), multi-select with bulk edit (date/payee/category/flag/cleared/delete/move to account), search with YNAB's filter syntax (`category:`, `payee:`, `memo:`, `amount:`, `is:cleared`, `before:`, `after:`, `>`, `<`), column sort, "All Accounts" register, uncategorized filter, date picker, amount field accepting math (`12.50+3`).
4. **Scheduled transactions** — all frequencies, "Enter Now" / "Skip", upcoming section at top of register, auto-enter on launch for scheduled transactions whose date has passed (with a review prompt).
5. **Credit cards** — §5.3 in full, plus the CC payment category's info popover (balance, available, "Pay in full" gap).
6. **Targets & auto-assign** — §5.4 and §5.5 in full, with the right-hand inspector panel showing target progress, assigned/activity/available for the selection, and quick-budget buttons.
7. **Payees** — payee manager (rename, combine, delete), rename rules (learned from edits: "Rename all future 'AMZN*' to 'Amazon'?"), default category per payee (learned from last use), transfer payees.
8. **Reconciliation** — §5.8 with the lock icon, "Reconcile" modal, reconciled-transaction edit warnings.
9. **Undo / redo** — Ctrl+Z / Ctrl+Y across every mutating action, with a toast describing what was undone. Command log persisted per session.
10. **Reports (Reflect)** — Spending Breakdown (donut by group/category, drill-in), Spending Trends (stacked bar over time), Net Worth (assets vs debts line/bar), Income vs Expense (table by month, categories as rows). Each with date range, account filter, category filter. Export each as CSV/PNG.
11. **Loan planner** — §5.10.
12. **Import / export** —
    - **YNAB migration:** import the YNAB export zip (`Plan.csv` + `Register.csv`). This is the #1 onboarding path; it must reproduce the user's budget *to the cent*, including historical assigned amounts, targets (YNAB doesn't export them — document this gap and offer a quick target re-entry screen), and CC payment categories. Golden tests use real anonymized exports.
    - **Bank files:** OFX/QFX, QIF, CSV (with a column-mapping dialog that remembers per-account mappings). Duplicate detection via FITID / (date, amount, payee) fuzzy match with a review step.
    - **Export:** full budget to CSV (matching YNAB's own export format so round-tripping to YNAB works), and a raw SQLite copy.
    - **Backups:** automatic timestamped copies on open (keep last N, configurable), manual "Export backup", "Restore from backup".
13. **Settings** — currency, number/date format, first month, theme (light/dark/system), font scale, default account for new transactions, keyboard shortcut reference, data folder location.
14. **Polish** — all YNAB keyboard shortcuts reproduced (document them; press `?` for the overlay), native Windows title bar or well-behaved custom one (snap layouts must work), high-DPI, accessibility (screen reader labels on the grid), multiple budgets ("Open budget…", recent list).
15. **Explicitly out of scope (wontfix):** bank sync / direct import, cloud sync, sharing a budget with another user over the network, mobile apps (the engine package is designed so one could be built later), YNAB Together / shared households.

---

## 7. Build phases

**Phase 0 — Spike (1 session).** Scaffold Tauri 2 + React + TS. Prove: SQLite read/write from a Tauri command, a 50k-row virtualized grid at 60 fps, custom title bar with working snap layouts, `.msi` build runs on Sarg's Windows PC. If any of these fails, switch stack per §2 and record the ADR. **Do not write budget features in Phase 0.**

**Phase 1 — Engine.** `packages/engine` with the full domain model, all of §5, and a test suite that includes golden tests from a real YNAB export. No UI. Deliverable: `pnpm test` green, `docs/budget-math.md` complete.

**Phase 2 — Shell + persistence.** SQLite schema + migrations, command/undo system, YNAB import script producing a loadable `.hafb` file.

**Phase 3 — Budget sheet + accounts + register.** Checklist items 1–5. This is where the app becomes usable daily.

**Phase 4 — Targets, payees, reconciliation, scheduled.** Items 6–9.

**Phase 5 — Reports, loans, bank import, settings, polish.** Items 10–14.

Mark phase status here when it changes:
- Phase 0: done. Validated on Sarg's machine 2026-10-08 (ADR 0001 §7). The spike screens (`apps/desktop/src/spike/`, `src-tauri/src/spike/`) are still in place; remove them when the real UI replaces them.
- Phase 1: todo
- Phase 2: todo
- Phase 3: todo
- Phase 4: todo
- Phase 5: todo

---

## 8. Workflow and commands

```
pnpm install
pnpm dev              # tauri dev (hot reload UI)
pnpm test             # vitest, all packages
pnpm test:engine      # engine only, fast — run before every commit
pnpm lint             # eslint + tsc --noEmit + cargo clippy
pnpm build            # tauri build → apps/desktop/src-tauri/target/release/bundle/
pnpm import:ynab <zip> <out.hafb>   # not wired yet (Phase 2)
```

- pnpm 12's `minimumReleaseAge` supply-chain gate is on. If an install trips it, pin an older version; don't add exclusions.

- **Plan first.** For anything touching §5 or the schema, write the plan (which rules, which tests, which migration) before code. Ask if the YNAB behavior is ambiguous — don't guess and bury it.
- **Tests before UI** for all budget math. A PR that changes `packages/engine/src` without touching `packages/engine/test` is wrong by default.
- **Migrations are append-only.** New file, new number. Include a down migration only if trivial; otherwise document that the migration is irreversible and that the app backs up before applying.
- **Keep the engine pure.** No `Date.now()`, no `Math.random()`, no I/O in `packages/engine`. Pass `today` in.
- **Commit style:** `area: what changed` (e.g. `engine: credit overspending carries forward negative`). One logical change per commit.
- **Performance budget:** app launch to usable budget sheet < 1.5 s on a 2019-era laptop with a 20k-transaction budget; register scroll at 60 fps; any single budget recompute < 50 ms for 5 years × 100 categories.
- **Validation step is mandatory:** after any UI or Rust change, run `pnpm build` and state explicitly what Sarg should click on the real machine to verify. Don't claim it works.

---

## 9. Conventions

- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`. No `as` casts outside of test fixtures and the DB boundary.
- Money type: `type Minor = number & { readonly __brand: 'Minor' }` with `add/sub/mul/divRound` helpers in `packages/shared/money.ts`. Formatting lives in one place and respects the budget's currency settings.
- Dates: `type ISODate = \`${number}-${number}-${number}\``; `type Month = \`${number}-${number}\``. Helpers in `packages/shared/dates.ts`. Never `new Date()` on these strings (time zone bugs).
- Engine API shape: `computeBudget(snapshot: BudgetSnapshot, opts: { today: ISODate }): BudgetState` where `BudgetState` is fully serializable. UI reads from `BudgetState`, never recomputes.
- Rust: thin. Commands do I/O and return plain JSON. No business logic in Rust.
- UI density: match YNAB's budget sheet row height (~34 px) and register row height (~30 px). Tabular numerals everywhere money is shown.
- Error handling: engine throws typed errors (`InvariantViolation`, `ValidationError`); UI never swallows them silently — surface in a toast with the undo option when applicable.
- Naming: use YNAB's user-facing vocabulary in the UI (*Ready to Assign*, *Assigned*, *Activity*, *Available*, *Targets*, *Plan*, *Reflect*) so YNAB refugees feel at home. Internal names can be whatever is clearest.

---

## 10. Things not to do

- Don't add a dependency without stating why in the commit message and confirming it makes no network calls.
- Don't store derived budget numbers as truth. Cache if you must, invalidate aggressively.
- Don't put math in React components.
- Don't "simplify" a YNAB rule because it's awkward. Parity is the point; if a rule seems wrong, write down the exact YNAB behavior and ask.
- Don't ship a migration that can lose data without an automatic pre-migration backup.
- Don't use floats for money, ever, including in CSV import parsing (parse the string to minor units directly).
- Don't mark a phase done until Sarg has run it on the real machine.
