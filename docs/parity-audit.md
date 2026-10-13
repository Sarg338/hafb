# Final parity audit (S8.5, 2026-10-12)

The roadmap's S8.5 exit asks for a final audit of [ynab-parity.md](ynab-parity.md) that leaves only the S8.6 rows open. This is that audit: what was checked, what it found, and what was done about it.

**Result:** 160 rows. 154 are `done`, 4 are `wontfix` (they need YNAB's servers), and 2 are `todo`: AC-11 and IE-12, the optional SimpleFIN bank sync that is S8.6. The audit found 7 real gaps, and all 7 are now built and tested. *Since then (2026-10-12):* S8.6 built those two, so all 156 non-server rows are `done`.

## How it was checked

1. **Every `done` row against the code and its tests.** Four reviewers took sections 1–4, 5–8, 9–12 and 13–15. For each row they found the code that implements it and the tests that exercise it: unit, store, Rust or release-app smoke. Each row got one of three verdicts: *covered*, *works but the UI is untested*, or *gap* (the code doesn't do what the row says).
2. **Against YNAB as it is now.** YNAB's What's New (2025 to 2026-10-07), its "Updates to YNAB" page and the help-center articles behind each section were read again. Each feature was matched to a row or found missing.
3. **Against YNAB itself.** Where the help center is silent, the YNAB trial on Sarg's PC was used (2026-10-12):
   - the credit card payment inspector;
   - its target types, with one target saved, read and deleted again;
   - progress-bar sections in October and November;
   - the register search's suggestions for a word, a number and "is";
   - **View Options**;
   - the plan menu.

   The trial plan was left as it was.
4. **In the release app.** Every fix was driven in the release build: by scripts with screenshots, and by the smoke suite (`apps/desktop/smoke/app.smoke.ts`, "parity audit (S8.5)").

## Gaps found and closed

| Row | What was wrong | What YNAB does (source) | Now |
|---|---|---|---|
| T-12 | A credit card payment category couldn't have a target, so "the alert follows the target" was never true. | Two card targets: **Pay Off Balance by Date** (a month) and **Pay Specific Amount Monthly** (an amount); the inspector offers "Create a Debt Payoff Target" (trial). With a target the pill follows it. | Built: engine `payOff` targets, migration 0007, the inspector's card target section and editor, the pill. Trial numbers reproduced: owes $50, $40 available, due next month → "Assign $5.00 this month to stay on track". |
| CC-07 | Credit Card Interest had no nudge toward a payoff target. | "You'll also be nudged to set up a target to pay off the interest" (What's New, 2026-10-07). | The payment category's target section says what interest cost this month and offers the debt payoff target. |
| P-10 | Progress bars had no rollover or extra sections. | Rollover gets its own first section for "set aside"; spending or assigning past the target adds an extra section; overspending ends in red (progress bars guide; trial). | Built; `planView.test.ts` and the gallery cover them. |
| R-14 | The row claimed live search suggestions; there were none. | Suggestions while typing: matching categories and accounts, Is: states, Outflow/Inflow comparisons for a number, an Income: hint, and Find in any field / Payee / Category / Memo (searching guide; trial). | Built, plus the criteria YNAB's list offers that HAFB didn't parse: *Cleared or Reconciled*, *Needs Category*, *Unapproved or Needs Category*, *Income: October 2026*. |
| R-16 | No Show Images option. | View Options has Show Reconciled Transactions, Show Flags and Show Images (searching guide, 2026-09-28; trial). | Added. |
| R-22 / PY-02 | No "Don't rename as", and HAFB *asked* before learning a rename. | Editing an imported payee creates an IS rule; "Don't rename as [Payee]" adds the bank's name as a payee and removes the IS rules; deleting that payee turns renaming back on (renaming guide, 2026-09-17). | Both built as documented. |
| IE-01 | The YNAB import guessed account types with no way to correct them. A YNAB mortgage arrived as a Liability, without HAFB's loan tools. Making it a loan later would have back-posted interest YNAB had already charged. | YNAB's export has no types; the old design note said "ask the user to confirm on import". | A **Check your account types** step, limited to the same kind so no number can change. A loan's charges start after the export (migration 0007). |

Wording fixed without a code change:
- **T-08:** Edit Plan mode is YNAB's mobile apps only; the web makes targets from the inspector, as HAFB does.
- **P-09:** the underfunded icon is a clock.
- **RC-01:** the flow is Yes, or No → bank balance → Create Adjustment & Finish.
- **PL-06:** text size goes to 200%.
- **R-19, PY-01:** these now name YNAB's 2026 behaviours, which HAFB already had.
- **L-07:** the celebration is for a payment that clears the balance.

## The rest of YNAB's 2025–2026 What's New

Every other entry is already a row or is out of scope:

- **Already rows:**
  - Plan Reset → P-24
  - Credit Card Interest → CC-07
  - File-Based Import Elevated → IE-03, IE-07
  - 2-of-3 categorization and manual defaults → PY-03, PY-04
  - card payment matching → CC-08
  - the "Matched" search filter → R-14
  - Hide Amounts → P-25
  - Photos → R-21
  - Share Your Progress → RF-09
  - bulk memo editing → R-12
  - cover from future months → P-16
  - starred accounts → AC-07
  - "budget" → "plan" → done
- **Out of scope:**
  - referral trials and gifts;
  - Card Mode, Income vs Spending, the transaction editor and the other mobile-only screens;
  - the API;
  - who moved the money (YNAB Together);
  - bank connections and their statuses;
  - UK Apple Wallet;
  - the For You feed.

One small difference is kept on purpose: YNAB's renaming rules are IS and CONTAINS, and HAFB's Manage Payees also offers *starts with*. YNAB's plan menu has **Edit Flags**; HAFB renames flags from the register's flag menu (R-06).

## Test coverage the audit asked for

The reviewers marked rows that work but whose UI no automated test touched. The ones that could hide a wrong number or a broken flow now have tests:

| Rows | Test added |
|---|---|
| IE-01 | Smoke: a YNAB import from the welcome screen, with the type step. Ready to Assign matches the store's import of the same zip. |
| T-12, CC-06, CC-07 | Smoke: a pay-off target on Visa Rewards survives a relaunch. Unit: the payment pill with and without a target. |
| R-14, R-16 | Smoke: suggestions while typing; choosing one filters; Show Images hides the photo column. |
| R-22, PY-02 | Smoke: renaming an import is learned for the next import; Don't rename as keeps the bank's name. |
| RC-01, RC-03 | Smoke: the No path with an adjustment; a lock unlocks one transaction. |
| RF-04, RF-06, RF-07 | Smoke: Spending Trends, Income v Expense and Age of Money open and show the plan. |
| S-06, P-10 | Unit (`planView.test.ts`): the upcoming calendar; rollover, extra and overspent sections. |
| P-22, P-06, P-25 | Unit: the Underfunded, Overfunded and Snoozed views; unhiding a category; Hide Amounts masking. |

Left as hand-checked, because a regression would be obvious on screen and the logic underneath is tested:

- the custom title bar and Snap Layouts (X-01, validated in Phase 0);
- the loan payoff celebration and the "Add loan details" button (L-07);
- Share Your Progress's format and switches (RF-09);
- the recent-plans list on the welcome screen (PL-01);
- the right-click register menu's less common items (R-11).

The golden tests that prove the YNAB import to the cent use real exports kept on this PC only (`packages/engine/test/fixtures/local`, git-ignored); a fresh checkout runs the synthetic import tests and the export round trip.
