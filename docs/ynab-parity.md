# YNAB parity checklist

- **Scope:** every YNAB user-facing feature (web app, as of October 2026), with the HAFB sprint that delivers it (`docs/roadmap.md`) and its status.
- **Status values:** `todo | in-progress | done | wontfix`.
- **When to update:** in the same commit that changes a feature's status.
- **Sources:** YNAB What's New and help center, researched 2026-10-08 (see `docs/ynab-references.md`). Section headers link the main source article. "§" refers to CLAUDE.md.

A row is `done` only after Sarg validates it on hardware. Rows whose engine half is finished (Phase 1, 2026-10-08) are `in-progress` until their UI ships.

## 1. Plan screen ([plan header](https://support.ynab.com/en_us/the-plan-header-BkmiuJ_C9), [colors & icons](https://support.ynab.com/en_us/colors-and-icons-in-your-plan-HJQv_XHko), [progress bars](https://support.ynab.com/en_us/progress-bars-a-guide-SkDEhot09))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| P-01 | Month navigation (previous/next, month picker, Today button off the current month), month note | S1.2 | S4.1 | done |
| P-02 | Ready to Assign banner: green (money to assign) / grey "All Money Assigned" / red "assigned more than you have" | S1.2 | S4.1 | done |
| P-03 | Ready to Assign breakdown (non-zero lines + total; D11 verified) | S1.2 | S4.3 | done |
| P-04 | Category groups and categories: add, rename, delete with reassignment (reassign asked only when there's history; where YNAB places a new group or category is to verify — HAFB adds it last and scrolls to it) | S1.2 | S4.2 | done |
| P-05 | Drag reorder of groups and categories | — | S4.2 | done |
| P-06 | Hide/unhide categories (Hidden Categories group) | S1.2 | S4.2 | done |
| P-07 | Collapse/expand groups, collapse all (Ctrl+Up/Down) | — | S4.1 | done |
| P-08 | Assigned / Activity / Available columns; inline assign with math (+ − × ÷) | S1.2 | S4.2 | done |
| P-09 | Available pills: green, yellow (underfunded, or overspent only on credit, with a card icon), red (cash overspending), grey; icons (calendar = upcoming shortfall, pie = underfunded, snooze) | S1.4 | S4.1 | in-progress |
| P-10 | Segmented progress bars (rollover / weekly / extra; light = spent, dark = available) | S1.4 | S4.1 | done |
| P-11 | Display Options: progress bars on/off; balance style "differentiate without color"; theme | — | S4.1 / S7.1 | in-progress |
| P-12 | Cash overspending (zeroed next month, reduces Ready to Assign) | S1.2 | S4.1 | done |
| P-13 | Credit overspending (resets to 0 next month; stays as card debt the payment category doesn't cover) | S1.3 | S4.1 | done |
| P-14 | Overspent banner / Overspent focused view (shown only when something is overspent) | S1.2 | S4.3 / S5.3 | done |
| P-15 | Move money from the Available popover (to/from any category or Ready to Assign) | S1.5 | S4.3 | done |
| P-16 | Cover overspending, including from future months | S1.5 | S4.3 | done |
| P-17 | Negative Ready to Assign: Fix This (un-assign from a category); future-month shortfall warning on Assigned in Future Months, without taking this month below zero | S1.2 | S4.3 | done |
| P-18 | Category notes | — | S4.2 | done |
| P-19 | Multi-select categories (checkboxes, Shift+Up/Down) | — | S4.2 | done |
| P-20 | Recent Moves (34 days; All/Moved/Assigned; event icons) | S2.3 | S5.7 | done |
| P-21 | Per-category assigned history (3 months) | S2.3 | S5.7 | done |
| P-22 | Focused Views: built-ins Underfunded, Overfunded, Snoozed, Money Available (+ Overspent) | S1.5 | S5.3 | done |
| P-23 | Focused Views: up to 12 custom, reorderable, remembered per device; hidden categories excluded | — | S5.3 | done |
| P-24 | Plan Reset (all unspent → Ready to Assign; CC payments keep money; confirm + undo) | S1.5 | S5.3 | done |
| P-25 | Hide Amounts toggle | — | S4.1 | done |
| P-26 | Undo / Redo buttons in the plan toolbar | S2.3 | S4.1 | done |

## 2. Inspector ([inspector](https://support.ynab.com/en_us/the-inspector-an-overview-ryylY7OCq))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| I-01 | Plan summary: Available in [Month] = left over + assigned + activity | S1.2 | S5.1 | done |
| I-02 | Cost to Be Me: this month's targets vs expected income (editable) | S1.4 | S5.1 | done |
| I-03 | Assigned in the Future: total, per-month list, next-month funded pie | S1.2 | S5.1 | done |
| I-04 | Auto-Assign section with live amounts per option | S1.5 | S5.3 | done |
| I-05 | Category detail: available-balance breakdown (left over, assigned, cash spending, credit spending) | S1.2 | S5.1 | done |
| I-06 | Category detail: target card (ring %, "Assign $X more", Assign button, needed / funded / to go) | S1.4 | S5.2 | done |
| I-07 | Category detail: upcoming scheduled + "available after upcoming" | S1.6 | S5.1 | done |
| I-08 | Multi-selection totals; collapsible sections remembered | — | S5.1 | done |
| I-09 | "For You" content feed | — | — | wontfix (server content) |

## 3. Targets ([how to use targets](https://support.ynab.com/en_us/how-to-use-targets-rk5kkI9ks), [underfunded logic](https://support.ynab.com/en_us/underfunded-a-guide-BJwPhQO09))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| T-01 | Cadences: weekly (weekday), monthly (day / last day), yearly (date), custom (by date) | S1.4 | S5.2 | done |
| T-02 | Behaviors: Set aside another / Refill up to / Have a balance of (non-repeating custom only) | S1.4 | S5.2 | done |
| T-03 | Custom repeat every N months/years | S1.4 | S5.2 | done |
| T-04 | Underfunded calculation per cadence × behavior (§5.4) | S1.4 | S5.2 | done |
| T-05 | Statuses: on track, underfunded, funded, overspent, snoozed | S1.4 | S5.2 | done |
| T-06 | Snooze (Shift+Z), current month only | S1.4 | S5.2 | done |
| T-07 | Target editor with behavior explanations and the "Most people choose this" hint | — | S5.2 | done |
| T-08 | Edit Plan mode (pencil); target suggestions from history | S1.4 | S5.2 | done |
| T-09 | Expected income (for Cost to Be Me) | S1.4 | S5.1 | done |
| T-10 | Legacy target types mapped on import | S1.4 | S2.4 | in-progress |
| T-11 | Monthly Debt Payment target for paired loan categories | S1.7 | S6.4 | done (the paired category's target becomes a Monthly Debt Payment with the payoff calculator and a due day) |
| T-12 | CC payoff target drives the CC underfunded alert | S1.3 | S5.2 | done |

## 4. Auto-Assign ([auto-assign](https://support.ynab.com/en_us/auto-assign-a-guide-r1gBNbBJo))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| A-01 | Underfunded | S1.5 | S5.3 | done |
| A-02 | Assigned Last Month | S1.5 | S5.3 | done |
| A-03 | Spent Last Month | S1.5 | S5.3 | done |
| A-04 | Average Assigned (12 months) | S1.5 | S5.3 | done |
| A-05 | Average Spent (12 months) | S1.5 | S5.3 | done |
| A-06 | Reduce Overfunding | S1.5 | S5.3 | done |
| A-07 | Reset Available Amounts | S1.5 | S5.3 | done |
| A-08 | Reset Assigned Amounts | S1.5 | S5.3 | done |
| A-09 | Scope: selection → focused view → all; amount preview; one undo step | S1.5 | S5.3 | done |

## 5. Accounts ([account types](https://support.ynab.com/en_us/account-types-an-overview-BkmGM0qCq))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| AC-01 | Cash accounts: checking, savings, cash | S1.2 | S4.4 | done |
| AC-02 | Credit accounts: credit card, line of credit | S1.3 | S4.4 | done |
| AC-03 | Loan accounts: mortgage, auto, student, personal, medical, other debt | S1.7 | S4.4 / S6.4 | done |
| AC-04 | Tracking accounts: asset, liability | S1.2 | S4.4 | done |
| AC-05 | Add account flow with starting balance (incl. negative for credit) | S1.2 | S4.4 | done |
| AC-06 | Edit (nickname, notes, working balance → Manual Balance Adjustment, loan details), close (a balance is zeroed with an adjustment after a warning), reopen; closed group | — | S4.4 | done |
| AC-07 | Sidebar groups with totals; Starred accounts section | — | S3.3 / S4.4 | done |
| AC-08 | Reorder accounts; account notes | — | S4.4 | done |
| AC-09 | Register header: cleared + uncleared = working balance | S1.6 | S4.4 | done |
| AC-10 | Cash-type transactions auto-marked cleared | S1.6 | S4.5 | done |
| AC-11 | Linked accounts, optional, via SimpleFIN Bridge instead of YNAB's providers (ADR 0006) | — | S6.7 | todo |

## 6. Register ([split](https://support.ynab.com/en_us/split-transactions-a-guide-SJLEKwY0q), [search](https://support.ynab.com/en_us/searching-transactions-a-guide-r1gxyQryj), [shortcuts](https://support.ynab.com/en_us/keyboard-shortcuts-Skw9Xp9A9))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| R-01 | Add / edit / delete inline; Enter, Tab, Esc, Ctrl+Enter | — | S4.5 | done |
| R-02 | Payee picker: Payments & Transfers group, saved payees, Manage Payees | S1.6 | S4.5 | done (Manage Payees under the payee list, S5.5) |
| R-03 | Category picker with available amounts and suggestions | S1.6 | S4.5 | done |
| R-04 | Transfers (paired legs; category rules per §5.9) | S1.2 | S4.5 | done |
| R-05 | Cleared toggle (C), reconciled lock | S1.6 | S4.5 | done |
| R-06 | Flags: 6 colors + custom names (Shift+F, 0–6) | — | S4.5 | done |
| R-07 | Memo; date picker with YNAB keys (+/−, T, M, Shift+M, Y, Shift+Y) | — | S4.5 | done |
| R-08 | Amount math in outflow/inflow (+ − × ÷) | S1.1 | S3.2 | done |
| R-09 | Optional running balance column | S1.6 | S4.5 | done |
| R-10 | Split transactions (S) with amount remaining, add another split, transfer in split | S1.6 | S4.6 | done |
| R-11 | Multi-select with checkboxes; floating action bar; right-click menu | — | S4.6 | done |
| R-12 | Bulk Categorize (K), Memo…, Flag, Clear, Approve, Move to Account, Duplicate, Delete (YNAB has no bulk date or payee edit; verified in the trial 2026-10-08) | S1.6 | S4.6 | done |
| R-13 | Duplicate transaction (Shift+D) | — | S4.6 | done |
| R-14 | Search with criteria syntax (`Category:`, `Payee:`, `Memo:`, `Outflow: >=`, Before/After/On, flag, Split, Matched, Approved, `is:`), Ctrl+Shift+F | S1.6 | S4.6 | done (live suggestions while typing: S7.4) |
| R-15 | Column sort | — | S4.6 | done |
| R-16 | View options: date presets (incl. Last Month), show/hide reconciled | — | S4.6 | done |
| R-17 | All Accounts register | — | S4.6 | done |
| R-18 | Banners: "N new transactions to approve or categorize", uncategorized filter | S1.6 | S4.6 | done |
| R-19 | Approve (A) / reject (Shift+R) / unapproved state | S1.6 | S6.5 | done (Reject, Shift+R, only for unapproved imports; never re-imports) |
| R-20 | Match (M) / unmatch (Shift+U) | S1.6 | S6.5 | done (auto-match on import; Match, M, for one import + one entered; Unmatch, Shift+U, restores both) |
| R-21 | Photo attachments (thumbnail, viewer) stored in the .hafb | — | S7.6 | todo |
| R-22 | Bank Import Details panel (original payee/memo as imported) | — | S6.5 | done (Bank Import Details: imported payee, memo, date and amount; match note) |
| R-23 | New transaction shortcut (Shift+N) | — | S4.5 | done |
| R-24 | Retailer order-history links | — | — | wontfix (server) |

## 7. Scheduled transactions ([scheduled](https://support.ynab.com/en_us/scheduled-transactions-a-guide-BygrAIFA9))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| S-01 | All 13 frequencies; 31st → last day of month | S1.6 | S5.4 | done |
| S-02 | Collapsible Scheduled section in register; no plan impact until due | S1.6 | S5.4 | done |
| S-03 | Due items appear bold and unapproved | S1.6 | S5.4 | done |
| S-04 | Enter Now / Skip | S1.6 | S5.4 | done (Enter Now dates an early entry today: an assumption, budget-math §8.1; Skip Next is in the right-click menu) |
| S-05 | Make repeating (Shift+T); recurring icon | — | S5.4 | done |
| S-06 | Upcoming shortfall: calendar icon on Available | S1.6 | S5.4 | done |
| S-07 | Scheduled splits and transfers | S1.6 | S5.4 | done |

## 8. Credit cards ([CC payments](https://support.ynab.com/en_us/credit-card-payments-a-guide-r1_506Q1j), [CC activity](https://support.ynab.com/en_us/credit-card-activity-an-overview-Sk2mLluA9))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| CC-01 | Payment category auto-created per card | S1.3 | S4.7 | done |
| CC-02 | Spending moves funded amount to the payment category | S1.3 | S4.7 | done |
| CC-03 | Payments, refunds, interest and fees as categorized outflows | S1.3 | S4.7 | done |
| CC-04 | Activity popover: spending, returns, funded spending, payments | S1.3 | S4.7 | done (matches the trial plan to the cent) |
| CC-05 | Record Payment (pre-fill = min(available, cleared balance)) | S1.3 | S4.7 | done |
| CC-06 | Pay-in-full gap; underfunded alert (current month) | S1.3 | S4.7 | done (payoff-target variant with T-12, S5.2) |
| CC-07 | Credit Card Interest categorization (YNAB rolling out Oct 2026; research first) | S1.3 | S7.x | todo (not in the trial plan yet; revisit when YNAB documents it) |
| CC-08 | CC payment auto-matching across checking ↔ card on import | S1.6 | S6.5 | done (a card payment imported on both sides pairs into a transfer) |

## 9. Payees ([categorizing](https://support.ynab.com/en_us/categorizing-transactions-a-guide-HyRl60sks))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| PY-01 | Payee manager: rename, combine, delete | — | S5.5 | done |
| PY-02 | Rename rules learned from edits | S1.6 | S5.5 | done (Manage Payees renaming rules apply on import; renaming an imported payee offers "Rename future … imports?") |
| PY-03 | Default category: 2-of-last-3 rule | S1.6 | S5.5 | done |
| PY-04 | Fixed default category per payee; auto-categorize off per payee | S1.6 | S5.5 | done |
| PY-05 | Transfer payees (system-managed) | S1.2 | S4.5 | done |

## 10. Reconciliation ([reconciling](https://support.ynab.com/en_us/reconciling-accounts-a-guide-BJFE3fHys))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| RC-01 | Reconcile flow (Shift+E): confirm cleared balance → yes / "Let's fix it" | S1.6 | S5.6 | done |
| RC-02 | Reconciliation Balance Adjustment transaction | S1.6 | S5.6 | done |
| RC-03 | Lock icons; reconciled-edit warning (unlocks one transaction) | — | S5.6 | done |
| RC-04 | Hide/show reconciled; "Reconciled N days ago" | — | S5.6 | done |

## 11. Reflect ([Reflect](https://support.ynab.com/en_us/reflect-in-ynab-B1GJsrWkj), [export](https://support.ynab.com/en_us/how-to-export-reflection-data-Bykou09))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| RF-01 | Filters: category tree, account tree (Select All/None), timeframe presets + custom, previous/next | S1.7 | S6.1 | done (YNAB trial 2026-10-09: presets, Custom start/end, search, "N Selected Categories"; remembered per plan file) |
| RF-02 | Drill-down transaction modal | S1.7 | S6.1 | done (Account / Date / Payee / Memo / Amount; a row opens the transaction in its register) |
| RF-03 | Spending Breakdown: donut, stack-ranked list, positive-inflow categories | S1.7 | S6.2 | done (Categories / Groups toggle, group drill-in, Positive Inflow Categories, hidden categories marked) |
| RF-04 | Spending Trends: stacked bars, average line, Totals/Trends toggle | S1.7 | S6.2 | done (stacked by group, drill into a group, month table with Compared to Average; YNAB 2026 has no Totals/Trends toggle) |
| RF-05 | Net Worth: assets vs debts bars, net worth line, month list with change | S1.7 | S6.3 | done (hover a month; change with its percentage) |
| RF-06 | Income v Expense: collapsible income/expense groups, average, total, net income | S1.7 | S6.3 | done (YNAB layout; every amount opens its transactions) |
| RF-07 | Age of Money page (6m / 1y / 2y; empty until 10 outflows) | S1.7 | S6.3 | done |
| RF-08 | Export: CSV/TSV (Net Worth, Income v Expense); two files with transactions (Spending reports) | S1.7 | S6.1 | done (YNAB's layouts; TSV for decimal-comma currencies; a zip for the Spending reports) |
| RF-09 | Share Your Progress image (amounts hidden), plus PNG export of any chart | — | S6.3 | done (four formats, tagline and amounts switches, our own look; PNG of any chart) |

## 12. Loans ([loan accounts](https://support.ynab.com/en_us/loan-accounts-in-ynab-a-guide-HkNSkPHJi))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| L-01 | Loan setup: rate, escrow, fees, minimum payment, original principal | S1.7 | S6.4 | done (rate, minimum payment, escrow on mortgages, fees, original amount) |
| L-02 | Monthly interest auto-posted (editable) | S1.7 | S6.4 | done (posted on the 1st as Interest / Escrow / Fees; editable like any transaction; a deleted one is never re-posted) |
| L-03 | Payment allocation: interest + escrow first, then principal | S1.7 | S6.4 | done |
| L-04 | Paired category; Record Payment; Monthly Debt Payment target | S1.7 | S6.4 | done (pair or create a category; one loan per category; Record Payment pre-fills Available; the inspector shows the loan) |
| L-05 | Payoff calculator: payment ↔ payoff date, interest saved | S1.7 | S6.4 | done (Loan Payoff Simulator: monthly payment ↔ payoff date, interest remaining, time remaining; totals match YNAB to the cent, budget-math §10.5) |
| L-06 | Loan Planner what-if extra payments | S1.7 | S6.4 | done (a higher monthly payment and a one-time extra this month; Interest Savings and Time Savings as YNAB words them, Reset all changes; +$500 on the trial mortgage matches YNAB exactly) |
| L-07 | Missing-details indicator; no auto-close at $0; payoff celebration | — | S6.4 | done (gear in the sidebar and an "Add loan details" button; loans never close themselves; a celebration when the balance reaches zero) |

## 13. Import / export ([file import](https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo), [approve & match](https://support.ynab.com/en_us/approving-and-matching-transactions-a-guide-ByYNZaQ1i))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| IE-01 | YNAB export import (Plan.csv + Register.csv), to the cent | S1.8 | S2.4 / S7.2 | in-progress |
| IE-02 | Target re-entry screen after YNAB import | — | S7.2 | todo |
| IE-03 | CSV import: column mapper per account, date formats, swap inflow/outflow, semicolons | S1.6 | S6.5 | done (delimiter, header, date order and decimal mark detected; mapping remembered per account; header guesses checked on public Chase, Capital One, Schwab, N26, Outbank, UBS and credit-union layouts; UTF-8, UTF-16 and Windows-1252 files) |
| IE-04 | OFX/QFX import, several files at once; QIF import | S1.6 | S6.5 | done (checked on public sample files from US Bank, Navy Federal, Wells Fargo, BMO, WaMu, CIBC, RBC, ATB and Fidelity) |
| IE-05 | Dedupe: FITID + fuzzy; skip > 3 days before last reconciliation; keep zero rows | S1.6 | S6.5 | done (bank ids; same date and amount across formats; 3-day reconciliation rule; zero rows kept; optional pre-start rows) |
| IE-06 | Auto-match imports to entered/scheduled (same amount, ≤ 10 days) | S1.6 | S6.5 | done |
| IE-07 | Imported cash inflows default to Ready to Assign; rename rules applied | S1.6 | S6.5 | done (YNAB-style payee cleanup too; the bank's text is kept) |
| IE-08 | Rejected imports never re-import | S1.6 | S6.5 | done |
| IE-09 | Export to YNAB-format CSV (round-trip verified) | S1.8 | S6.6 | done (Plan.csv + Register.csv in YNAB's layout; round-trips through the YNAB importer to the cent. YNAB has no whole-plan import; its File Import read our Register.csv into an account, mapping Date, Payee, Memo, Outflow and Inflow by itself: trial, 2026-10-09, previewed and cancelled) |
| IE-10 | Raw SQLite copy ("save a copy") | — | S2.5 | done (Save a copy…, S2.5) |
| IE-11 | Automatic backups on open (keep N), manual backup, restore | — | S2.5 / S6.6 | done (keep 3–100, a chosen folder, Back up now, restore) |
| IE-12 | Bank sync, optional, via SimpleFIN Bridge: on open, every ~6 h while open, Sync now; same review pipeline as file import (ADR 0006) | S1.6 | S6.7 | todo |
| IE-13 | Pending transactions | — | — | wontfix (server) |

## 14. Plans, settings, lifecycle ([resets & fresh starts](https://support.ynab.com/en_us/plan-resets-and-fresh-starts-HkXYR_c0q), [templates](https://support.ynab.com/en_us/creating-a-plan-template-ByZJZx_R9))

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| PL-01 | Multiple plans: open, recent list, create | — | S2.5 / S7.2 | in-progress |
| PL-02 | New-plan wizard: blank / template / import YNAB | — | S7.2 | todo |
| PL-03 | Templates: bundled category sets; pick categories to import; never overwrite | — | S7.2 | todo |
| PL-04 | Fresh Start (archive + new plan, §5.14; verify starting-balance rule) | S1.5 | S7.2 | in-progress |
| PL-05 | Settings: currency & decimals, number/date format, first month | S1.1 | S7.1 | in-progress |
| PL-06 | Settings: theme (light/dark/system/high contrast), font scale | — | S7.1 | in-progress |
| PL-07 | Settings: default account, data folder, shortcuts on/off | — | S7.1 | todo |
| PL-08 | Template sharing by link; YNAB Together; referrals; subscriptions | — | — | wontfix (server) |

## 15. Keyboard, accessibility, polish

| ID | Feature | Engine | UI | Status |
|---|---|---|---|---|
| K-01 | Undo Ctrl+Z; redo Ctrl+Shift+Z (and Ctrl+Y) with descriptive toast | S2.3 | S4.8 | in-progress |
| K-02 | Every published YNAB shortcut ([list](https://support.ynab.com/en_us/keyboard-shortcuts-Skw9Xp9A9)) | — | S7.3 | todo |
| K-03 | `?` shortcut overlay; hints in menus and tooltips; disable toggle | — | S3.5 / S7.3 | in-progress |
| X-01 | Custom title bar with Snap Layouts; native fallback | — | Phase 0 ✅ / S3.3 | done |
| X-02 | High-DPI 100–200%, multi-monitor | — | S7.7 | todo |
| X-03 | Screen-reader grid semantics, focus visibility, high contrast, reduced motion (WCAG 2.2 AA) | — | S3.4 / S7.4 | todo |
| X-04 | Onboarding: resumable setup checklist; designed empty states | — | S7.5 | todo |
| X-05 | Celebrations (target met, loan paid off) | — | S5.2 / S6.4 | done (target met, S5.2; loan paid off, S6.4) |

## Out of scope (wontfix, needs YNAB's servers)

YNAB's Direct Import providers (Plaid/MX/TrueLayer/Apple Card; HAFB uses SimpleFIN instead, IE-12), pending transactions, institution logos, retailer order history, YNAB Together (members, avatars, who-moved-it), "For You" feed, API/Zapier/widgets/Siri/Watch, mobile apps and mobile-only screens (Home tab, Card Mode, Income vs Spending), referrals and gifts, Mint migration, template sharing by link.
