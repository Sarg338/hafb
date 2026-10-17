# Moving from YNAB to HAFB

HAFB reads YNAB's own export, the zip YNAB gives you from **Export Plan**, and rebuilds your plan from it: every account, every transaction and what you assigned in every month. The numbers come out the same as YNAB's, to the cent. This takes about five minutes.

The words are YNAB's too (*Plan*, *Ready to Assign*, *Assigned*, *Activity*, *Available*, *Targets*, *Reflect*), and so are the keyboard shortcuts. [user-guide.md](user-guide.md) covers HAFB in full.

In this guide, **bold** words are the names of buttons and menus exactly as YNAB or HAFB shows them.

## 1. Export your plan from YNAB

1. Open YNAB in your web browser and the plan you want to move.
2. Click the plan's name at the top left, then **Export Plan**.
3. YNAB downloads a zip named like `My Plan as of 2026-10-12 08-00.zip`. Leave it zipped.

The export is YNAB as it is at that moment, so export after your last change in YNAB. Exporting doesn't change anything in YNAB. Your YNAB plan's own currency, number and date formats are fine: HAFB reads them, including a decimal comma.

## 2. Import it into HAFB

Install HAFB first ([install.md](install.md)). Then any of these opens the import:

- **Import YNAB export (.zip)…** on the welcome screen;
- **Import YNAB export…** in the plan menu (click the plan's name at the top of the sidebar);
- **Import your YNAB export instead** in the New Plan dialog.

Pick the zip. HAFB reads it and asks you to **Check your account types**.

## 3. Check your account types

YNAB's export doesn't say what type each account is, so HAFB works it out and shows you its guesses:

| HAFB guesses | Because | You can choose |
|---|---|---|
| Credit Card | it has a category in Credit Card Payments | Credit Card, Line of Credit |
| Checking | it has categorized transactions (it is on your plan) | Checking, Savings, Cash |
| Liability or Asset | it has no categorized transactions (it is off your plan), owing or owning | Mortgage, Auto Loan, Student Loan, Personal Loan, Medical Debt, Other Debt, Asset, Liability |

Pick the right one for each, then **Continue**. Only types of the same kind are offered, so your choice never changes a number: a cash account stays on your plan as a cash account, a card stays a card, and a loan or tracking account stays off your plan. *An account's type can't be changed later*, as in YNAB, so take a moment here.

**Loans:** choose the loan's type (Mortgage, Auto Loan…) rather than Liability to get HAFB's loan tools: monthly interest, the payoff simulator and a paired payment category. After the import, use **Add loan details** on the account to enter its rate and payment. HAFB posts interest from the month after your export; the months before already hold what YNAB charged.

Then choose where to save the plan file. HAFB opens it and shows **Your YNAB plan is in**: how much came across and how each account's type was decided.

## 4. Add your targets

YNAB's export has no targets. On the summary, **Add targets…** opens **Add your targets**: a row per category with a target type (for example *Monthly: set aside another*, *Monthly: refill up to*, *Have a balance of*, or *No target*) and an amount, filled in with what you assigned on average over the last three months. **Save targets** sets them all in one step; **Skip for now** leaves them for later. You can always add or change a target from the category itself (select it, then **Create Target** in the inspector).

## What comes across

- Every account, with its balance and its full history.
- Every transaction: date, payee, category, memo, amount, flag colour, and cleared or reconciled state. Splits come across as splits and transfers as paired transfers.
- Your category groups and categories in YNAB's order, including Hidden Categories and Credit Card Payments.
- What you assigned in every month, so every month's Assigned, Activity and Available, Ready to Assign, credit card payments and overspending match YNAB.
- Scheduled transactions YNAB had entered for future dates, as one-off scheduled transactions.

This was checked against two real YNAB plans: every value YNAB showed for a test plan matches, and so does every regular category of a public, years-long plan. The only differences there were on one card YNAB had converted from another account type (`docs/budget-math.md` §12).

## What doesn't come across, and what to do

YNAB's export leaves these out, so HAFB can't bring them:

| Missing from the export | In HAFB |
|---|---|
| Targets | **Add targets…** on the import summary, or one at a time from each category |
| Account types | the step above |
| Loan details (rate, payment, escrow) | **Add loan details** on the loan account |
| How scheduled transactions repeat | they arrive as one-offs: open one and set its repeat when you see it |
| Closed and starred accounts | everything arrives open; close an account with **Close account…** and star with **Star** (right-click it in the sidebar) |
| Account, category and month notes | type them again where you need them |
| Payee settings and renaming rules | HAFB learns renaming again when you change an imported payee; **Manage Payees…** has the rest |
| Flag names | flag colours come across; **Rename flags…** in the register's flag menu names them |
| Expected income (Cost to Be Me) | **Edit expected income** in the inspector |
| Approval state | everything arrives approved |

## Check it

Open the current month on both sides and compare:

- **Ready to Assign** on the Plan screen;
- a few categories' **Available**, especially credit card payment categories and anything overspent;
- each account's working balance in the sidebar.

They should match exactly. If one doesn't, a transaction was probably entered in YNAB after you exported: export again and import into a new file.

## Running both for a while

You don't have to switch in one go. Keep entering transactions in both, or import the same bank file into each, and compare at the end of the month. HAFB's file import reads the same CSV, OFX, QFX and QIF files YNAB does ([user-guide.md §10](user-guide.md#10-importing-from-your-bank)).

## What HAFB doesn't do

HAFB has everything in YNAB's web app except what needs YNAB's servers: YNAB's linked bank connections are replaced by optional bank sync through SimpleFIN Bridge, a service you pay for yourself ([user-guide.md §10](user-guide.md#bank-sync-optional)), or a file from your bank and **File Import**. There's no YNAB Together sharing, no mobile apps and no cloud sync. Your plan is a file on your PC; put it in a OneDrive or Syncthing folder if you want it on another PC.

## Going back

**Export for YNAB (CSV)…** in the plan menu writes YNAB's own `Plan.csv` and `Register.csv`. YNAB has no whole-plan import, but its **File Import** reads that `Register.csv` into an account.

## Problems

- **"This doesn't look like a YNAB export"**: pick the zip itself, not a folder or a file inside it. Very old exports call the plan file `Budget.csv`; those work too.
- *A warning about a transfer with no matching leg:* YNAB exported one side of a transfer without the other (usually because one account was deleted in YNAB). HAFB keeps it as a regular transaction; check that account's balance.
- *A warning about an unknown flag:* the flag is left off that transaction.
