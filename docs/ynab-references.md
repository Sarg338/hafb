# YNAB reference links

Pages to consult when designing parity features. Behavior described here is YNAB's; HAFB reproduces it locally (see CLAUDE.md §6). Saved 2026-10-08.

| Area | Link | Notes |
|---|---|---|
| Direct import | https://support.ynab.com/en_us/how-direct-import-works-H1IGYLgnxl | Bank sync is out of scope (§6.15); useful for file-import duplicate-matching UX. |
| App lineup | https://www.ynab.com/our-app-lineup | Which surfaces YNAB ships. |
| Templates | https://www.ynab.com/whats-new/ynab-templates | In §6 and `ynab-parity.md` (PL-03). |
| Focused views | https://www.ynab.com/whats-new/introducing-focused-views | In §6 and `ynab-parity.md` (P-22, P-23). |
| What's new | https://www.ynab.com/whats-new | Changelog; check for features newer than §6. |
| Goal tracking | https://www.ynab.com/features/goal-tracking | Targets, §5.4. |
| Debt management | https://www.ynab.com/features/debt-management | Loan accounts / planner, §5.10. |
| Reports and data | https://www.ynab.com/blog/ynab-reports-and-data | Reflect reports, §6.10. |

## YNAB export format (observed 2026-10-08)

Taken from a public, real export dated 2026-09-14 that's kept local-only (`packages/engine/test/fixtures/local/ynab-public-sample/`, git-ignored; it's personal data under a restrictive license, so it's **never committed or quoted**), and from a [public converter gist](https://gist.github.com/StephenBrown2/1d1cdf5710a917d7ef1c09314d097fe3). Only the format facts are recorded here.

- **Files:** `<Plan name> as of YYYY-MM-DD HH-MM - Plan.csv` and `... - Register.csv`, in a zip. Older exports name the plan file `Budget.csv`. Both are UTF-8 **with a BOM**, every field quoted. Currencies that use a decimal comma export TSV instead.
- **Plan.csv columns:** `Month, Category Group/Category, Category Group, Category, Assigned, Activity, Available`.
  - Month looks like `Dec 2021`.
  - There's one row per category per month, including the `Credit Card Payments` and `Hidden Categories` groups.
  - These are **YNAB's own computed values**, which makes the file a golden answer key for Activity and Available.
- **Register.csv columns:** `Account, Flag, Date, Payee, Category Group/Category, Category Group, Category, Memo, Outflow, Inflow, Cleared`.
  - Rows are sorted newest first.
  - `Flag` is a color name (`Red`, …) or empty.
  - `Cleared` is `Cleared`, `Uncleared` or `Reconciled`.
  - Transfers have the payee `Transfer : <Account>`, one row per leg.
  - Inflows to Ready to Assign have the category `Inflow: Ready to Assign`.
  - Uncategorized rows (transfers between on-budget accounts and off-budget accounts) have empty category fields.
- **Amounts and dates follow the plan's own currency and date settings.** For example, `370.52$` (symbol after the number) and dates `30-09-2026` (DD-MM-YYYY). Outflow and Inflow are both non-negative.
  - The parser must take the format as a parameter (or detect it) and turn the text straight into minor units. No floats.
- **Not in the export:** account types, on-budget vs off-budget status, targets, notes, scheduled transactions.
  - Account types have to be inferred: credit cards from the names in `Credit Card Payments`, off-budget accounts from having only uncategorized rows. Ask the user to confirm on import.
- **Splits:** this sample has none. Per the YNAB community, split lines export as separate rows with a `(Split n/m)` memo prefix. **Unverified.** Confirm with the trial scenario before relying on it.
