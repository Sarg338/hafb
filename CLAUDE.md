# HAFB — Here's A Free Budget

Free, local-only, native Windows envelope-budgeting app. Target: **complete feature parity with YNAB** (the web/desktop product as of 2026), minus anything that requires YNAB's servers (shared-budget cloud sync, mobile apps). YNAB's own bank sync is replaced by an optional SimpleFIN Bridge link (ADR 0006).

This file is the durable source of truth for the project. Read it fully before doing anything. Update it when a decision is made or a phase completes — stale CLAUDE.md is worse than none.

---

## 1. Non-negotiables

- **Local-only.** No network calls, ever, with one opt-in exception: bank sync through SimpleFIN Bridge (ADR 0006). It is off by default, talks only to the SimpleFIN host the user linked, runs only in Rust, and never sees bank credentials. Its access URL lives in Windows Credential Manager, never in the plan file. No telemetry, no crash reporting, no update checks, no analytics. The app must work with the network cable unplugged and must never ask for an account. If a library phones home, it is not allowed in.
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
- **UI:** React 19 + TypeScript (strict). State via Zustand. Styling: **CSS Modules over theme custom properties** (decided S3.2, ADR 0004). Every colour, font, size, radius, rule style and duration comes from a theme token, enforced by `src/theme/sourceScan.test.ts`. No Tailwind (density matters; utility classes fight tabular UI). Components live in `apps/desktop/src/ui/`, with a dev gallery at `#/gallery`.
- **Grid:** TanStack Table for the register and budget sheet. Virtualized. Must handle 50k+ transactions without jank.
- **Storage:** SQLite via `tauri-plugin-sql` (sqlx under the hood) **or** `rusqlite` behind Tauri commands. Spike decides. WAL mode. Migrations via numbered SQL files, applied on open, never edited after shipping.
- **Budget engine:** Pure TypeScript package (`packages/engine`), zero dependencies on Tauri/DOM. It takes a snapshot of data in, returns computed budget state out. This is what gets tested exhaustively, and it is what makes a future Android/web port possible.
- **Tests:** Vitest for engine + UI logic. A Playwright smoke suite drives the real release app over WebView2's DevTools port (`playwright-core`, ADR 0005; `pnpm smoke`). Rust: `cargo test` for commands.
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
    roadmap.md               ← phases and sprints to v1.0 (§7), with exit criteria
    ynab-references.md       ← YNAB pages used as parity sources
    ui-references/ynab/      ← YNAB screenshots for design study (git-ignored; copyrighted)
    budget-math.md           ← worked examples for every rule in §5
  packages/
    engine/                  ← pure TS budget engine (no I/O, no DOM, no Tauri)
      src/
      test/
        fixtures/            ← YNAB export CSVs + expected outputs (golden tests)
    shared/                  ← types shared between engine, UI, and Rust bindings
    store/                   ← pure TS: PlanData records, row codec, commands, undo, YNAB import (ADR 0002)
  apps/
    desktop/                 ← Tauri app
      src/                   ← React UI
      src-tauri/             ← Rust: window, generic SQLite store + `hafb-store` CLI, file dialogs
        migrations/          ← 0001_init.sql, 0002_... never edited after merge
  scripts/
    import-ynab.ts           ← YNAB export → HAFB SQLite (also exposed in-app)
```

Monorepo with pnpm workspaces. `packages/*` must never import from `apps/`. `packages/store` may import the engine; the engine never imports the store.

---

## 4. Domain model

Entities (table ≈ TS type ≈ Rust struct; keep them in lockstep via `packages/shared`). Updated 2026-10-08 for YNAB's 2026 behavior (roadmap D1–D13).

- **Budget** (user-facing name: **Plan**; YNAB renamed "budget" to "plan" in May 2025):
  - Fields: name, currency (ISO 4217), decimal digits, date format, number format, first month, expected monthly income (for *Cost to Be Me*), `archived_at` (set by Fresh Start), settings.
  - One SQLite file = one Plan.
- **Account:** name, type, `on_budget: bool`, `closed: bool`, `starred: bool`, note, sort order, last reconciled at.
  - Sidebar groups follow YNAB, plus **Starred** on top:
    - **Cash:** `checking`, `savings`, `cash`.
    - **Credit:** `credit_card`, `line_of_credit`.
    - **Loans** (off-budget): `mortgage`, `auto_loan`, `student_loan`, `personal_loan`, `medical_debt`, `other_debt`.
    - **Tracking** (off-budget): `asset`, `liability`.
    - **Closed.**
  - Loan accounts also carry: interest rate (bps), escrow amount, fees, minimum payment, original principal, payment schedule, `paired_category_id` (optional; one loan per category).
  - Transactions in cash-type accounts are created **cleared** by default.
- **CategoryGroup:** name, hidden, sort order, `system_kind` (`inflow` | `creditCardPayments` | `hidden`; NULL for user groups; ADR 0002 §3).
  - The system groups are *Credit Card Payments* and *Hidden Categories*, plus the implicit *Inflow* group that holds *Ready to Assign*.
- **Category:** group, name, hidden, note, sort order, `credit_card_account_id` (set only for CC payment categories).
- **Target:** one per category, cadence × behavior (§5.4).
  - Fields: snoozed months, created date (`createdOn`), updated.
  - Not versioned: an edit applies to all past and future months, as in YNAB.
- **FocusedView:** name, sort order, category ids.
  - Up to 12 custom views. The built-in views (Underfunded, Overfunded, Snoozed, Money Available, plus Overspent when applicable) store only their order.
  - The selected view is a per-device preference, not stored in the file.
- **Payee:** name, `transfer_account_id` (transfer payees are system-managed), default category, `default_category_fixed: bool`, `auto_categorize: bool`, `hidden: bool` (not suggested while typing; migration 0002), note, deleted.
- **PayeeRenameRule:** pattern (contains / starts with / equals, case-insensitive), target payee.
- **Transaction:**
  - Core fields: account, date, payee, category, memo, amount (signed minor units; negative = outflow).
    - Category is nullable for transfers between on-budget accounts and for off-budget accounts.
  - State: `cleared: uncleared | cleared | reconciled`, `approved: bool`, flag color (nullable).
  - Links: `transfer_transaction_id` (the paired leg), `scheduled_transaction_id` (origin, if any).
  - Import: import id (FITID or synthetic `file:amount:date:n`), what the bank said (payee, memo, date, amount: migration 0003), `matched_at` and the entered amount a match replaced (so Unmatch restores both), `isStartingBalance` (YNAB payee "Starting Balance").
  - Soft delete: deleted.
- **Subtransaction:** parent transaction, category, payee (optional override), memo, amount, transfer leg.
  - Invariant: the parent amount must equal the sum of its subtransactions, and the parent has no category. Enforced in the engine and by the schema's `split_violations` view, which the store checks before every commit (a trigger can't be deferred; ADR 0002 §3).
- **ScheduledTransaction:** everything a Transaction has, plus a frequency and `next_date`.
  - Frequencies: `never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear`.
  - Scheduled sub-transactions too. A day-of-month past a month's end clamps to the last day.
- **MonthCategory:** (month, category) → `assigned` minor units.
  - This is the only user-entered budget number.
  - `activity` and `available` are always derived, never stored as authoritative. They may be cached with an invalidation key.
- **MoneyMove:** a durable log of assignment changes (timestamp, month, from, to, amount, kind: move / auto-assign / assign-from-RTA / return-to-RTA / category-deleted / plan-reset).
  - Feeds *Recent Moves* (34 days) and per-category assigned history (3 months).
- **MonthNote**, **CategoryNote:** free text.
- **Reconciliation:** account, date, statement (cleared) balance, adjustment transaction id.
- **RejectedImport:** (account, import id), so rejected or deleted imports never re-import.
- **ImportProfile:** per-account CSV column mapping, date format, swap-inflow/outflow, delimiter.
- **Attachment:** transaction, MIME type, bytes (BLOB, *inside* the .hafb, so a plan is still one file), created.

Soft deletes everywhere (`deleted_at`). Every mutating action goes through a command object so undo/redo (§6) is a replay of inverse commands.

IDs: UUIDv7 (time-sortable). They are generated outside the engine and passed in, so the engine stays pure.

---

## 5. Budget math — the rules

These are the YNAB semantics HAFB must reproduce exactly. Each rule gets worked examples in `docs/budget-math.md` and a test in `packages/engine/test/`. Month boundaries are calendar months in the budget's local date (no time zones — dates are `YYYY-MM-DD` strings).

### 5.1 Core identity
For each category and month:
```
available(m) = available(m-1)_carried + assigned(m) + activity(m)
```
- `activity(m)` = sum of transaction amounts in month `m` categorized to this category (outflows negative), across all **on-budget** (Cash and Credit) accounts. Transactions in Loans and Tracking accounts never touch categories, except the on-budget leg of a transfer (§5.9).
- `available(m-1)_carried`:
  - if `available(m-1) >= 0` → carries forward in full.
  - if `available(m-1) < 0` and the overspending is **cash** → carries as `0`; the shortfall reduces next month's Ready to Assign (see 5.3).
  - if `available(m-1) < 0` and the overspending is **credit** → also carries as `0`. The uncovered amount stays as card debt the payment category doesn't cover (an underfunded payment category), and it does **not** reduce Ready to Assign.
    - *Corrected 2026-10-08.* This file previously said credit overspending "carries forward as the negative amount". That's wrong per YNAB's docs ([overspending](https://support.ynab.com/en_us/overspending-in-ynab-a-guide-ryWoxEyi), [month rollover](https://support.ynab.com/en_us/when-the-month-rolls-over-a-guide-rkyyd6qC9)) and per real data: all 186 negative month-ends in the golden export reset to 0.
- A month's overspending is classified at **month level, credit first**: overspending is attributed to credit up to the category's net credit-card spending that month, and the remainder is cash. Verified on the golden export; a chronological model fits much worse. Documented with examples in `docs/budget-math.md` §3.

### 5.2 Ready to Assign (RTA)
```
RTA(m) = RTA(m-1)
       + inflows to "Inflow: Ready to Assign" in month m (on-budget accounts only)
       - sum of assigned(m) across all categories
       - cash overspending from (m-1)   [see 5.1]
       + (assigned in future months is NOT subtracted here — see 5.2.1)
```
- RTA can go negative; UI shows it red with "You assigned more than you have."
- **5.2.1 Future months:** money assigned in a future month reduces RTA *in that future month and all months after it*, and YNAB also shows it as "Assigned in Future" in the current month's RTA breakdown, reducing the headline RTA number, **but never below zero**: the future part is capped at what the month has left, and the shortfall shows in the future month itself (verified in the YNAB trial, 2026-10-08; budget-math §2 examples 2.5–2.6). The breakdown popover lists only non-zero lines: *Inflow: Ready to Assign transactions in [Month]*, *Assigned in [Month]*, *Assigned in Future*, then the total (D11 verified). The Inspector's *Available in [Month]* = left over + assigned + activity.
- **Starting balances** of cash accounts (and a card's credit in your favour) are inflows to RTA, dated to the account's start date. A card's starting **debt** is *Category not needed*: it doesn't touch RTA or any category, and the payment category shows it as underfunded (verified in the YNAB trial, 2026-10-08; budget-math §3.12). *Corrected 2026-10-08:* this previously said a negative card starting balance was an outflow from RTA.

### 5.3 Credit cards
- Creating a credit card account creates a hidden-from-user-deletion category *"<Card Name>"* in the *Credit Card Payments* group, linked via `credit_card_account_id`.
- A categorized outflow on a credit card account moves money: category available decreases by the amount, **and** the CC payment category available increases by the same amount — but only up to the amount the category actually had. If the category was already at 0 or would go negative, the uncovered portion does **not** move to the payment category (this is the mechanism behind credit overspending).
- When the credit overspending in a category involves several cards (or several card transactions), the unfunded part is taken from the **most recent card outflows first** (last in, first out; ties broken by entry order). This is inferred from the golden data, not documented by YNAB; it fixed every case where two cards share an overspent category.
- A transfer from a cash account to the CC account is a payment: it reduces the CC payment category's available by the payment amount and does not touch any other category.
- Inflows (refunds) categorized on a CC account reverse the movement.
- Interest/fees charged on the card are regular categorized outflows on the card (user categorizes them, usually to a "Interest & Fees" category).
- The CC payment category's *available* is how much cash is set aside to pay the card. Account balance vs. available = the "pay in full" gap. Show it.
- **Record Payment** pre-fills the lower of the payment category's available amount and the card's cleared balance.
- **Underfunded alert** on the payment category (current month only) when available < card balance. If the card has a payoff target, the alert follows the target instead.
- YNAB is rolling out **Credit Card Interest** categorization (Oct 2026): interest stays out of the plan and doesn't overspend a category. Its details are thin, so research it before implementing; keep it behind a flag.

### 5.4 Targets
YNAB reworked targets in May 2024. A target is a **cadence** plus a **behavior**:

- **Cadence:**
  - `weekly`: due on a weekday.
  - `monthly`: due on a day of the month or the last day.
  - `yearly`: due on a date.
  - `custom`: an amount due by a date, either repeating every N months/years or one-time.
- **Behavior:**
  - **Set aside another…**: assign the amount every period regardless of what's available, so money builds up. YNAB labels this "most people choose this".
  - **Refill up to…**: top the category up so Available reaches the amount each period; unspent money counts toward the next period.
  - **Have a balance of…**: reach X by a date and don't spend from it. Allowed only on a non-repeating `custom` target. Underfunded = the remaining amount spread evenly over the remaining months, including this one.

Rules:

- An edit applies to all past and future months; targets aren't versioned.
- Refunds don't count toward targets. Define this precisely in `docs/budget-math.md`.
- **Legacy mapping** (YNAB import and old exports):

  | Old type | New target |
  |---|---|
  | Needed for Spending | matching cadence + behavior |
  | Savings Balance by date | custom + *Have a balance of* with a date |
  | Target Balance (no date) | *Have a balance of* with no date |
  | Monthly Savings Builder | monthly + *Set aside another* |

- **Computed per (category, month):**
  - Amounts: target amount, needed this month, funded, to go, `underfunded` (what to assign now to be on track).
  - `status`: `on_track | underfunded | funded | overspent | snoozed`.
  - Progress-bar data: rollover section, one section per week for weekly targets, an "extra" section when spending exceeds the target; light shade = spent, dark = available.
  - Progress-ring percentage.
- **Snooze:** for the current month only; underfunded = 0 that month and status = snoozed.
- **Verified against YNAB (trial, 2026-10-08):**
  - "Have a balance of" with no date never asks for money (no underfunded amount, not in Cost to Be Me).
  - Weekly due days before the target's creation date need no funding.
  - Refill targets viewed in a **future** month ignore leftover money (weekly/monthly cadences).
  - Overspending is not a target status: status is snoozed / underfunded / funded / on track / inactive.
- **Expiry:** a non-repeating target whose due month has passed becomes inactive.
- **Cost to Be Me:** the sum of full weekly/monthly target amounts plus this month's share of multi-month targets (no-date balances excluded), compared with the plan's expected income.
- **Edit Plan** can suggest target amounts from historical spending.

### 5.5 Auto-assign
These options act on the selected categories, or else on the current Focused View, or else on everything visible:
- `Underfunded`.
- `Assigned Last Month`.
- `Spent Last Month`.
- `Average Assigned` (last 12 months).
- `Average Spent` (last 12 months).
- `Reduce Overfunding` (bring categories back down to their target).
- `Reset Available Amounts` (assign so available = 0).
- `Reset Assigned Amounts` (set assigned to 0).

Each option shows its amount before committing. Averages use integer division with round-half-up to the currency's minor unit. Every auto-assign action is one undo step and logs `MoneyMove`s.

Verified against YNAB (trial):
- "Spent" is −activity with its sign, and payment categories are skipped.
- Options that look back do nothing when the plan has no earlier month; averages use the months the plan has.
- Underfunded also covers scheduled bills with no target (current month) and a payment category's uncovered card debt (minus this month's credit overspending).
- Underfunded *shows* the full need; committing stops when Ready to Assign runs out, in priority order.
- Reset options act only on selected categories.

### 5.6 Move money, cover overspending, Plan Reset
- **Move money:** between any two categories (or Ready to Assign) within a month. `assigned` changes on both sides, net zero.
- **Cover overspending:** the same thing with the amount pre-filled. It may also draw from **future months** that have money assigned (YNAB, Jun 2025).
- **Plan Reset** (YNAB, Sep 2026):
  - Returns every unspent dollar to Ready to Assign, including money assigned in future months, so the user can reassign from scratch.
  - Credit card payment categories keep their money, and no category is left overspent.
  - Nothing is saved until the user confirms, and the reset is one undo step.
- Every change appends a `MoneyMove` (this drives *Recent Moves*).

### 5.7 Age of Money
YNAB's published facts:
- It's based on the last **10 outflows** from cash accounts.
- **Credit card payments count** as outflows.
- Transfers and starting balances are excluded.
- It stays empty until there are 10 outflows.
- It's shown on its own Reflect page (6-month, 1-year and 2-year ranges), no longer in the header.

YNAB does not publish its matching algorithm. Start from the FIFO community write-up, **verify it against Sarg's real export** in S1.7, and document the observed algorithm with examples in `docs/budget-math.md`.

### 5.8 Reconciliation
Enter statement balance → engine computes the difference between the **cleared** balance and the statement. If zero, mark all cleared transactions as reconciled. If not, offer to create an adjustment transaction (payee *"Reconciliation Balance Adjustment"*, categorized to RTA for on-budget accounts, uncategorized for tracking) then reconcile. Reconciled transactions warn on edit; editing one unlocks only that transaction.

### 5.9 Transfers
- On-budget ↔ on-budget: no category on either leg; no budget impact.
- On-budget → tracking (e.g. paying a mortgage from checking): the on-budget leg **does** get a category (it's spending from the budget's perspective); the tracking leg has none.
- Tracking → on-budget: the on-budget leg is an inflow to RTA (or any category).
- Both legs share a `transfer_group`; editing amount/date on one leg updates the other. Deleting one deletes both.

### 5.10 Loan accounts
Loans are their own off-budget account group.
- **Interest:** calculated automatically each month and posted to the loan account (payee *Interest*). The user can edit it to match the lender. Document the accrual formula, match YNAB, and check it against a real statement.
- **Mortgages:** carry escrow and fees. Each payment covers interest and escrow first, and the remainder goes to principal. Escrow is tracked separately and never reduces principal.
- **Paired category** (optional, one loan per category):
  - Payments to the loan must use it.
  - It enables **Record Payment** and a **Monthly Debt Payment** target with a payoff calculator (enter a payment → payoff date and interest saved, or pick a date → required payment).
- **Loan Planner:** what-if extra-payment simulations.
- **Account behavior:**
  - Loans don't auto-close at $0.
  - Paying a loan off triggers a celebration.
  - "Share Your Progress" exports a PNG with the amounts hidden.

### 5.11 Scheduled transactions
- Scheduled transactions don't affect the plan until their date. They live in a collapsible **Scheduled** section at the top of the register.
- On the date, each one becomes a real transaction, shown **bold and unapproved**. There's no launch-time review prompt; this replaces the old CLAUDE.md rule.
- Actions: *Enter Now*, *Skip*, *Make repeating* (Shift+T).
- A day-of-month past the end of a month clamps to the last day.
- **Shortfall warning:** if a category's available amount won't cover its upcoming scheduled outflows this month, flag it (calendar icon) and show "available after upcoming" in the inspector. Scheduled transactions are **not** projected into future months (YNAB trial).

### 5.12 Approval and matching
- `approved` is false for imported and auto-entered transactions. **Unapproved transactions still count** in the plan.
- Only unapproved transactions can be *rejected*. Rejected or deleted imports never re-import (`RejectedImport`).
- **Auto-match:** an entered or scheduled transaction matches an import with the same amount within 10 days.
  - The bank's amount wins.
  - The user's payee, memo and date are kept.
  - The import can be unmatched.
- Approving one leg of a transfer approves the other. Credit card payment legs (checking ↔ card) are paired by amount within a few days.
- **File import rules:**
  - Skip transactions dated more than 3 days before the account's last reconciliation.
  - Keep zero-amount rows.
  - Imported inflows to cash accounts default to Ready to Assign.
  - Apply payee rename rules.

### 5.13 Payee defaults
- A payee's default category changes only when **2 of its 3 most recent** transactions agree.
- The user can pin a fixed default (`default_category_fixed`) or turn auto-categorization off (`auto_categorize = false`).
- The category picker also suggests categories while the user types.

### 5.14 Fresh Start
- Archives the current plan: the file is kept, stamped *Archived* with today's date, and opens read-only.
- Creates a new plan that keeps the category structure, scheduled transactions, targets, expected income, notes and payees.
- Every account restarts with a **$0** "Starting Balance" transaction dated today (unlinked accounts in YNAB; HAFB never links banks). The user then enters today's balance. Verified on YNAB (trial, 2026-10-08).

---

## 6. Feature parity checklist

The full, current list lives in `docs/ynab-parity.md`: one row per feature, with source, sprint and status (`todo | in-progress | done | wontfix`). It was updated 2026-10-08 from YNAB's What's New and help center. The build order is in `docs/roadmap.md`. Summary by area:

1. **Plan core:**
   - Categories and groups: add, rename, drag reorder, hide/unhide, delete with reassignment.
   - Month navigation; assign with math; Assigned/Activity/Available with colored pills and segmented progress bars.
   - Ready to Assign banner (green / "All Money Assigned" / red), its breakdown, and future-month negative alerts.
   - Overspending (cash + credit); move money; cover overspending (incl. from future months); Recent Moves; month and category notes.
   - Display Options: progress bars on/off; balance style "differentiate without color".
   - **Focused Views** (built-in + 12 custom), **Plan Reset**, **Hide Amounts**, **Templates**, **Fresh Start** (§5.14).
2. **Inspector:** plan summary (Available in month), Cost to Be Me with expected income, Assigned in the Future, Auto-Assign with live amounts, category detail (available-balance breakdown, target progress, upcoming scheduled).
3. **Accounts:**
   - All types (§4), grouped Cash / Credit / Loans / Tracking / Closed, plus Starred.
   - Add/edit/close/reopen, starting balance, reorder, notes, and the cleared + uncleared = working balance header.
4. **Register:**
   - **Editing:**
     - Add/edit/delete inline (Enter commits, Tab moves, Esc cancels, Ctrl+Enter saves and adds another).
     - Splits with an "amount remaining" helper.
     - Transfers via a payee picker (Payments & Transfers group).
   - **Fields:** flags (6 colors + custom names), cleared toggle, memo, optional running balance, photo attachments.
   - **Selection & bulk actions:**
     - Multi-select with a floating action bar and right-click menu.
     - Bulk actions (as YNAB, verified 2026-10-08): categorize, memo, flag, clear, approve, move to account, duplicate, delete. YNAB has no bulk date or payee edit.
     - Duplicate (Shift+D).
   - **Search & views:**
     - YNAB criteria search (`Category: Dining Out, Outflow: >=30`, Before/After/On, `is:` …).
     - Sort; view options (date presets incl. Last Month, show/hide reconciled).
     - All Accounts register; uncategorized/unapproved banners.
   - **Entry helpers:** date picker with YNAB keys; amount math (`+ − × ÷`).
5. **Scheduled transactions:** §5.11 in full, all frequencies.
6. **Credit cards:** §5.3 in full, plus the activity popover, Record Payment, pay-in-full gap and underfunded alert.
7. **Targets & auto-assign:** §5.4 and §5.5 in full; the target editor and Edit Plan mode; snooze.
8. **Payees:** payee manager (rename, combine, delete), learned rename rules, defaults per §5.13, transfer payees.
9. **Reconciliation:** §5.8 with the lock icon, Reconcile flow (Shift+E), "Reconciled N days ago", reconciled-edit warnings.
10. **Undo / redo:** Ctrl+Z and Ctrl+Shift+Z (Ctrl+Y also accepted, as the Windows convention) on every mutating action, with a toast describing what was undone.
11. **Reflect:**
    - Spending Breakdown (donut, stack-ranked, positive-inflow section, drill-in).
    - Spending Trends (stacked bars over time, average line).
    - Net Worth (assets vs debts, net worth line, Share Your Progress).
    - Income v Expense (collapsible table with average and total).
    - Age of Money (line chart).
    - Category, account and timeframe filters; export as CSV/TSV and PNG.
12. **Loans:** §5.10 in full, including the Loan Planner.
13. **Import / export:**
    - **YNAB migration** (`Plan.csv` + `Register.csv`):
      - It's the #1 onboarding path and must reproduce the plan **to the cent**, including historical assigned amounts and CC payment categories.
      - Targets aren't exported by YNAB: offer a quick re-entry screen.
    - **Bank files:**
      - Formats: CSV (column mapper remembered per account, swap inflow/outflow, semicolons), OFX/QFX (several files at once), QIF.
      - Duplicate handling: FITID plus fuzzy matching, then an approve/reject/match review (§5.12).
    - **Bank sync (optional):** SimpleFIN Bridge per ADR 0006. The user pays SimpleFIN; the app syncs on open, about every 6 hours while open, and on *Sync now*. Transactions arrive unapproved and go through the same pipeline as file import.
    - **Export:** YNAB-format CSV (round-trips to YNAB) and a raw SQLite copy.
    - **Backups:** automatic on open (keep N), manual backup and restore.
14. **Settings:** currency, number/date format, first month, theme (light/dark/system/high contrast), font scale, default account, data folder, shortcuts on/off, Hide Amounts.
15. **Polish:**
    - Every published YNAB shortcut (`?` overlay, hints in menus).
    - A custom title bar with Snap Layouts (validated in Phase 0); high-DPI; WCAG 2.2 AA accessibility.
    - Multiple plans with an open/recent list; onboarding and designed empty states.
16. **Explicitly out of scope (wontfix):**
    - YNAB's Direct Import providers (Plaid, MX, TrueLayer; HAFB uses SimpleFIN instead), pending transactions, retailer order-history links.
    - Cloud sync; YNAB Together (shared plans, members, avatars).
    - The "For You" feed; the API, widgets and assistants; mobile apps (the engine stays portable for a future one).

---

## 7. Build phases

The full sprint plan with exit criteria is in `docs/roadmap.md`. Phases were renumbered on 2026-10-08 to add a design-system phase and a release phase.

- **Phase 0, Spike:** done (ADR 0001).
- **Phase 1, Engine:** all of §5 with tests first, plus golden tests from a real YNAB export. No UI.
- **Phase 2, Persistence:** schema and migrations, commands and undo, YNAB import, plan files and backups.
- **Phase 3, Design system & shell:** design direction, tokens and components, app shell, editable-grid foundation.
- **Phase 4, Daily driver:** Plan screen, accounts, register, credit cards, undo. Ends with **M1**: two weeks of real use alongside YNAB.
- **Phase 5, Planning power:** inspector, targets, auto-assign and Focused Views, scheduled, payees, reconciliation, Recent Moves (**M2**).
- **Phase 6, Reflect & data:** reports, loans, bank-file import, export and backups, optional SimpleFIN bank sync (**M3**: feature parity).
- **Phase 7, Polish:** settings, multiple plans, templates and Fresh Start, keyboard, accessibility, onboarding, attachments, visual polish.
- **Phase 8, Release:** performance at scale, reliability, privacy audit, packaging, docs and beta → **v1.0**.

Mark phase status here when it changes:
- Phase 0: done. Validated on Sarg's machine 2026-10-08 (ADR 0001 §7). The spike screens (`apps/desktop/src/spike/`, `src-tauri/src/spike/`) stay until S3.3 replaces them.
- Phase 1: done, signed off by Sarg 2026-10-08. Verified against two real YNAB sources (budget-math §12): the public export (98.4% exact, every regular category exact) and Sarg's YNAB trial plan (every value YNAB showed matches after 9 rule corrections; the mortgage simulator's interest matches to the cent since 2026-10-09). Age of Money and the weekly-target rule were confirmed by follow-up checks. Fresh Start was confirmed too. Remaining open items are in budget-math §13: YNAB's first posted mortgage interest (Nov 2026), the public sample's converted card, Credit Card Interest (rolling out) and recurrence edge cases.
- Phase 2: done, signed off by Sarg 2026-10-08 (ADR 0002). Tests: 537 TS + 25 Rust. Validated by driving the release build on Sarg's PC: import, edit, undo/redo, reopen, second-window lock, backup restore, save a copy, new plan; the empty `-wal` left after quitting was found and fixed. Carried into Phase 3: replace the browser `confirm()` box with an in-app dialog.
- Phase 3: done, signed off by Sarg 2026-10-08. S3.1 design direction (approved look; DESIGN.md; themes as data, ADR 0003). S3.2 component library in `src/ui` with gallery `#/gallery` (ADR 0004). S3.3 app shell in `src/shell` (spike and Phase 2 screens retired). S3.4 `DataGrid` (50k-row benchmark: 0 missed frames in WebView2; cells exposed to Narrator via UIA). S3.5 shortcut registry, `?` overlay, error surfacing, `pnpm smoke` (9 tests, ADR 0005). Launch to first paint 812 ms.
- Phase 4: in progress. S4.1 Plan screen, S4.2 Plan editing, S4.3 Moving money, S4.4 Accounts, S4.5 Register core, S4.6 Register power and S4.7 Credit cards done 2026-10-08 (S4.7 still needs the real-card check during M1) (ADR 0007: production screens in `src/screens` from the component library; the S3.1 mockups stay as the look reference).
- Phase 5: done in code 2026-10-08 (roadmap Phase 5 progress notes): S5.1 inspector, S5.2 targets, S5.3 Focused Views / scoped Auto-Assign / Plan Reset, S5.4 scheduled transactions, S5.5 Manage Payees (migration 0002 adds `payees.hidden`), S5.6 reconciliation, S5.7 Recent Moves. Smoke tests cover each in the release app. **M2** (a month on real data with YNAB closed) needs Sarg, so the phase isn't signed off.
- Phase 6: S6.1–S6.6 done in code 2026-10-09 (roadmap Phase 6 progress notes): S6.1 Reflect framework (ADR 0008), S6.2 Spending Breakdown & Trends, S6.3 Net Worth, Income v Expense, Age of Money and Share Your Progress, S6.4 Loans & loan planner, S6.5 Bank file import (migration 0003), S6.6 Export & backups. Smoke tests cover each in the release app. S6.7 (SimpleFIN) is deferred by Sarg to its own effort, so **M3** waits on it. Exit checks met 2026-10-09: bank import on 50 public sample exports from real banks and exports cell-exact in OpenOffice Calc (Sarg accepted both in place of his own bank files and Excel, which this PC lacks); the payoff simulator matches YNAB to the cent. The phase isn't signed off until Sarg runs it on the real machine.
- Phase 7: todo
- Phase 8: todo

---

## 8. Workflow and commands

```
pnpm install
pnpm dev              # tauri dev (hot reload UI)
pnpm test             # vitest, all packages
pnpm test:engine      # engine only, fast — run before every commit
pnpm lint             # eslint + tsc --noEmit + cargo clippy
pnpm build            # tauri build → apps/desktop/src-tauri/target/release/bundle/
pnpm import:ynab <zip> <out.hafb>   # YNAB export → plan file (--today, --name, --account-type "Name=type", --force)
pnpm test:rust        # cargo tests: store crate + app
pnpm smoke            # end-to-end smoke tests on the release app (run pnpm build first; or pnpm smoke:build)
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

- Don't add a dependency without stating why in the commit message and confirming it makes no network calls. The one exception is the S6.7 HTTP client for SimpleFIN (ADR 0006).
- Don't store derived budget numbers as truth. Cache if you must, invalidate aggressively.
- Don't put math in React components.
- Don't "simplify" a YNAB rule because it's awkward. Parity is the point; if a rule seems wrong, write down the exact YNAB behavior and ask.
- Don't ship a migration that can lose data without an automatic pre-migration backup.
- Don't use floats for money, ever, including in CSV import parsing (parse the string to minor units directly).
- Don't mark a phase done until Sarg has run it on the real machine.
