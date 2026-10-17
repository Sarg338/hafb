# Changelog

HAFB's releases, newest first. Versions follow `MAJOR.MINOR.PATCH`; betas are 0.9.x, and 1.0.0 is the first stable release. How to install, upgrade and check a download: [docs/install.md](docs/install.md).

## 0.9.1 (beta 2), 2026-10

- A new welcome screen. The ways in (import from YNAB, start a new plan, open a plan) and your recent plans are on the left. On the right is an example month of the Plan screen, with a note on what its colours mean. It used to sit in a narrow column at the left of the window.

## 0.9.0 (beta 1), 2026-10

The first beta. It has YNAB's web app in full, except what needs YNAB's servers. Testers, start with [docs/beta.md](docs/beta.md).

**Planning**
- The Plan screen as YNAB has it: Ready to Assign with its breakdown, Assigned / Activity / Available, coloured pills and progress bars, cash and credit overspending, moving money and covering overspending (from future months too), Recent Moves, notes, and Hide amounts.
- Targets: weekly, monthly, yearly and custom; *Set aside another*, *Refill up to* and *Have a balance of*; snooze; Cost to Be Me against your expected income.
- Credit card payment targets: *Pay Off Balance by Date* and *Pay Specific Amount Monthly*.
- Auto-Assign (all eight options), Focused Views (built-in and up to 12 of your own), and Plan Reset.

**Accounts and transactions**
- Accounts: Cash, Credit, Loans and Tracking, plus Starred and Closed.
- The register: splits, transfers, flags and photos, plus bulk actions. Search uses YNAB's criteria, with suggestions as you type, and View has YNAB's options.
- Scheduled transactions with all of YNAB's frequencies.
- Credit cards: payment categories, Record Payment, and the card's activity. *Credit Card Interest* is early, behind a preference.
- Loans: monthly interest and escrow, a paired payment category, the payoff simulator and the loan planner.
- Bank files (CSV, OFX, QFX, QIF):
  - Duplicates are skipped and your own entries are matched.
  - Imports wait for you to approve or reject them.
  - Payee renaming is learned as you go, with *Don't rename as*.
- Reconciling, with an adjustment when the balances differ.
- Manage Payees: rename, combine, hide and delete payees, set default categories, and edit renaming rules.

**Reflect**
- Spending Breakdown, Spending Trends, Net Worth, Income v Expense and Age of Money. Each has filters and drill-downs, CSV/TSV and image export, and Share Your Progress.

**Your data**
- One plan is one SQLite file you keep where you like. HAFB connects to nothing unless you link optional bank sync, and then only to SimpleFIN; [docs/privacy.md](docs/privacy.md) has the evidence.
- Import from YNAB's export, with every number to the cent. You confirm the account types first, and loans come across as loans. Export back to YNAB's CSV.
- Backups run on every open and on demand, with restore, Save a copy, templates and Make a Fresh Start.
- An optional password locks a plan (SQLCipher 4, AES-256). "Remember on this PC" stores it in Windows Credential Manager.
- Several plans, each in its own file. HAFB starts in the plan you had open when you last quit.

**Windows**
- An installer (MSI) and a portable zip. Upgrades keep your data, and so does uninstalling. The installer doesn't make a System Restore point, so it takes seconds.
- Every YNAB keyboard shortcut plus Windows' own. Light, dark, high-contrast and Windows contrast themes, text up to 200%, and WCAG 2.2 AA.
- Fast with large plans: a 20,000-transaction plan opens in under 1.5 seconds on a 2019-era laptop.

**Bank sync (optional)**
- Sync banks and credit cards through SimpleFIN Bridge, a service you sign up for yourself (about $15 a year, paid to SimpleFIN). Link it in Preferences, then choose each account's bank account in Edit Account.
- New transactions come in when a plan opens, about every 6 hours while it's open, and on Sync Now. They go through the same steps as bank files: unapproved, matched to your own entries, never twice. Pending transactions stay out.
- HAFB never sees your bank password. It talks only to SimpleFIN's server, and only once you've linked it. The link is kept in Windows Credential Manager when you tick *Remember on this PC*, otherwise only in memory until HAFB closes.

**Known limits:** see [docs/beta.md](docs/beta.md#known-limits-of-this-beta).
