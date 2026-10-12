# HAFB user guide

HAFB (Here's A Free Budget) is an envelope budget for Windows. You give every dollar you have a job, plan with money you have rather than money you expect, and watch where it goes. It works like YNAB and uses YNAB's words: *Plan*, *Ready to Assign*, *Assigned*, *Activity*, *Available*, *Targets*, *Reflect*. It is free, has no account or subscription, and never connects to the internet.

- Installing, upgrading, uninstalling and the portable version: [install.md](install.md).
- Coming from YNAB: [migrating-from-ynab.md](migrating-from-ynab.md).
- Every keyboard shortcut: [shortcuts.md](shortcuts.md). In the app, press `?` or F1.
- What HAFB does and doesn't do with your data: [privacy.md](privacy.md).

The app has its own short help too: **Help…** in the plan menu.

In this guide, **bold** words are the names of buttons, menus and fields exactly as the app shows them.

## Contents

1. [Plans and files](#1-plans-and-files)
2. [The Plan screen](#2-the-plan-screen)
3. [Assigning and moving money](#3-assigning-and-moving-money)
4. [Targets](#4-targets)
5. [Accounts](#5-accounts)
6. [Transactions (the register)](#6-transactions-the-register)
7. [Scheduled transactions](#7-scheduled-transactions)
8. [Credit cards](#8-credit-cards)
9. [Loans](#9-loans)
10. [Importing from your bank](#10-importing-from-your-bank)
11. [Reconciling](#11-reconciling)
12. [Payees](#12-payees)
13. [Reflect](#13-reflect)
14. [Settings](#14-settings)
15. [Backups, copies, exports and Fresh Start](#15-backups-copies-exports-and-fresh-start)
16. [Locking a plan with a password](#16-locking-a-plan-with-a-password)
17. [Undo, keyboard and accessibility](#17-undo-keyboard-and-accessibility)
18. [When something goes wrong](#18-when-something-goes-wrong)

## 1. Plans and files

A plan is one file on your PC (`.hafb`). You choose where it lives: Documents, a USB stick, or a OneDrive or Syncthing folder if you want it on more than one PC. HAFB never moves, copies or uploads it. It is a standard SQLite file, so any SQLite tool can read it.

The first time HAFB starts you see **Welcome to HAFB**:

- **Import YNAB export (.zip)…** brings a YNAB plan across ([migrating-from-ynab.md](migrating-from-ynab.md)).
- **Open plan…** opens a `.hafb` file. With the installed version you can also double-click one.
- **Start a new plan…** asks for a **Plan Name**, the **Currency** (with its **Currency Placement**), the **Number Format** and the **Date Format**, then whether to **Start with** **A blank plan** or **A template** (a ready-made set of categories). **Create Plan** then asks where to save the file.
- **Recent plans** lists what you opened before.

Once a plan is open, click its name at the top of the sidebar for the plan menu. **New plan…**, **Open plan…** and your five most recent plans are there, as is **Close plan**. Opening another plan replaces the one in the window; double-clicking a plan file starts another HAFB window for it. A plan already open in another window says so instead of opening twice.

## 2. The Plan screen

**Plan** in the sidebar shows one month of your plan.

- **The month.** The arrows go to the previous and next month; click the month's name to jump to any month. **Enter a note…** keeps a note for the month.
- **Ready to Assign** is money that has arrived and has no job yet. Green means there is money to assign; grey *All Money Assigned* means every dollar has a job; red means you assigned more than you have. Click the amount for its breakdown: what was left over, this month's income, what you assigned this month and in future months.
- **The grid.** Category groups hold categories. Each category shows **Assigned** (what you gave it this month), **Activity** (spending and refunds) and **Available** (what is left, which carries into next month).
- **Available colours.** Green has money; grey is empty; yellow is underfunded (its target needs more), or overspent on a credit card; red is cash overspending. A clock icon means underfunded, a card icon means credit overspending, a calendar icon means a scheduled transaction this month won't be covered, and *z* means snoozed. **Differentiate without color** (in **Display Options…** or the **Display options** menu, ⋯ at the top right) adds shapes so you don't need colour to tell them apart.
- **Progress bars** under each category show a target's progress: dark is money available, light is money already spent. Money left over from last month gets its own first section, each week gets one for weekly targets, and spending or assigning past the target adds an extra section at the end (red when the spending was more than the category had). **Show progress bars** turns them off.
- **Focused views** above the grid filter the list: **Underfunded**, **Overfunded**, **Money Available**, **Snoozed**, and *Overspent* when something is. **New View** makes your own (up to 12) from chosen categories; **Manage Views** renames, reorders and deletes them.
- **The toolbar:** **Category Group** adds a group, **Undo** and **Redo**, and **Recent Moves** (every assignment and move in the last 34 days).
- **Hide amounts** (the eye) masks every amount, for when someone is looking over your shoulder.

Click a group or category name to rename it, add a category to the group, hide it or delete it. Deleting a category with history asks where its money and transactions should go. Drag a row to reorder; Ctrl+↑ and Ctrl+↓ collapse and expand every group.

**The inspector** on the right shows the month's summary, **Cost to Be Me** (what your targets need against your expected income), **Auto-Assign**, and **Assigned in Future Months**. Select a category and it shows that category: its **Available Balance**, its target, Auto-Assign for that category, and **Notes**. Select several and it adds them up.

## 3. Assigning and moving money

- **Assign:** click a category's Assigned cell, type an amount and press Enter. Amounts take maths: `120+35`, `600/4`.
- **Assign** next to Ready to Assign offers **Auto** (the Auto-Assign choices below) or **Manually**.
- **Move money:** click a category's Available amount to move money to or from another category, or back to Ready to Assign. The same popover covers overspending, and it can take money assigned in future months.
- *When Ready to Assign is red,* **Fix This** takes money back from a category.
- **Auto-Assign** (inspector) fills categories at once: **Underfunded**, **Assigned Last Month**, **Spent Last Month**, **Average Assigned**, **Average Spent**, **Reduce Overfunding**, **Reset Available Amounts**, **Reset Assigned Amounts**. Each shows its amount first. It acts on the selected categories, else the focused view, else everything. Underfunded stops when Ready to Assign runs out, most urgent first.
- **Plan Reset…** (in the **Display options** menu, ⋯) returns every unspent dollar to Ready to Assign so you can plan from scratch. Credit card payments keep their money. Nothing changes until you confirm, and Undo puts it all back.
- **Overspending:** a red Available means you spent more than you had. Cover it from another category. Cash overspending left at the end of the month comes out of next month's Ready to Assign; overspending on a credit card becomes card debt instead (see [Credit cards](#8-credit-cards)).

## 4. Targets

A target tells a category what it needs. Select the category and choose **Create Target** in the inspector.

1. Choose how often: **Weekly** (a weekday), **Monthly** (a day or the last day), **Yearly** (a date) or **Custom** (a date, repeating every few months or years, or once).
2. **I need** the amount. HAFB suggests your average spending over the last 3 months.
3. Choose what to do each period:
   - **Set aside another** assigns the full amount every period, so money builds up. Use it for bills and saving over time. Most people choose this.
   - **Refill up to** tops the category up to the amount; what's left over counts. Use it for groceries, fuel, fun money.
   - **Have a balance of** (Custom only) saves toward an amount by a date, or eventually.
4. **Save Target.**

The inspector then shows the target's progress, what to assign this month to stay on track, and an **Assign** button that does it. **Edit Target** changes or deletes it. A change applies to every month, as in YNAB. **Snooze target for this month** (or Shift+Z) asks for nothing this month.

A credit card's payment category has its own two targets; a loan's paired category has a Monthly Debt Payment target (see [Credit cards](#8-credit-cards) and [Loans](#9-loans)).

Targets feed **Cost to Be Me** in the inspector: set your expected income with **Edit expected income** to see whether your targets fit.

## 5. Accounts

**Add Account** (bottom of the sidebar) asks for a nickname, the type and today's balance.

| Kind | Types | Part of the plan? |
|---|---|---|
| Cash | Checking, Savings, Cash | Yes |
| Credit | Credit Card, Line of Credit | Yes |
| Loans | Mortgage, Auto Loan, Student Loan, Personal Loan, Medical Debt, Other Debt | No: tracked, not planned |
| Tracking | Asset, Liability | No: tracked, not planned |

The sidebar groups accounts the same way, with **Starred** accounts on top and **Closed** ones at the bottom. Right-click an account for **Edit account…**, **Star**, **Move up**, **Move down** and **Close account…** (closing an account with money in it zeroes it with an adjustment first; **Reopen account** brings it back). You can also drag accounts to reorder them.

**Edit account…** changes the **Account nickname** and **Account notes**. Changing the **Working balance** adds an adjustment transaction. An account's type can't be changed later, as in YNAB.

**All Accounts** shows every account's transactions in one register.

## 6. Transactions (the register)

Click an account in the sidebar. The header shows its **Cleared Balance**, **Uncleared Balance** and **Working Balance**.

- **Add Transaction** (Shift+N) starts a row. Tab moves between Date, Payee, Category, Memo, Outflow and Inflow. Enter saves, Ctrl+Enter saves and starts another, Escape cancels. Cash accounts start their transactions as cleared.
- **Date:** `+` and `-` move a day, `T` is today, `M` and Shift+M the month's first and last day, `Y` and Shift+Y the year's.
- **Payee:** type to pick one, or a new name to create it. Transfers to your other accounts are under *Payments & Transfers*. **Manage Payees** is at the bottom of the list.
- **Category:** shows each category's Available amount, and suggests the payee's usual category. *Inflow: Ready to Assign* is for income. Transfers between two plan accounts take no category.
- **Splits:** press `S` (or choose split in the category) to divide a transaction across categories; the row shows the amount still to assign.
- **Flags:** Shift+F, then 0–6. **Rename flags…** in the flag menu names them.
- **Cleared:** `C` or the cleared icon. Reconciled transactions show a lock; editing one asks first.
- **Photos:** **Attach a photo** keeps a receipt inside the plan file.

Select rows with their checkboxes (Ctrl+A selects all) for the action bar, or right-click for the full menu: **Approve**, **Reject**, **Mark as Cleared**, **Match**, **Unmatch**, **Duplicate**, **Make Repeating**, **Flag…**, **Memo…**, **Categorize…**, **Move to Account…** and **Delete**.

**Search** (Ctrl+Shift+F) understands YNAB's criteria and suggests them as you type: `Payee: Corner Grocery`, `Category: Dining Out, Outflow: >=30`, `Memo:`, `Account:`, `Before:`, `After:`, `On:`, `Flag:`, `Income: October 2026`, and states such as `is: unapproved`, `is: uncleared` or `is: needs category`. Criteria separated by commas must all match.

**View** sets the dates shown (**This Month**, **Last Month**, **Latest 3 Months**, **This Year**, **Last Year**, **All Dates** or a From–To range) and **Show Reconciled Transactions**, **Show Flags**, **Show Images** and, in one account, **Show Running Balance**.

## 7. Scheduled transactions

Give a new transaction a date after today and it becomes scheduled: it sits in **Scheduled Transactions** at the top of the register and doesn't touch your plan until its date. Choose how often it repeats: from daily to every other year, including twice a month and every 4 weeks. A day past a month's end uses the month's last day.

On its date it enters itself, shown in bold and unapproved for you to check. `E` enters one early; **Skip Next** (right-click) moves it to its next date; **Make Repeating** (Shift+T) turns any transaction into a schedule.

If a category's Available won't cover what's scheduled this month, its pill shows a calendar and the inspector shows the *Available After Upcoming* amount.

## 8. Credit cards

Every credit card gets a payment category in **Credit Card Payments**.

- When you spend on the card from a category that has the money, that money moves to the card's payment category, ready to pay the bill. A refund moves it back.
- If the category didn't have the money, the difference is credit overspending: yellow, with a card icon. It becomes card debt that the payment category doesn't cover. Assign more to the payment category to pay it down.
- Paying the card is a transfer from checking to the card. **Record Payment** in the card's register fills in what the payment category holds, up to the cleared balance.
- The payment category shows the card's Activity in detail (click its Activity), and the inspector shows the card's balance and what is set aside.
- **Card targets:** select the payment category and choose **Create a Debt Payoff Target**. **Pay Off Balance by Date** plans to clear the card by a month you pick, spreading what's needed evenly; **Pay Specific Amount Monthly** sets aside a set amount each month (use it for a minimum payment). With a target, the category follows the target instead of asking for the full balance.
- **Credit Card Interest** (early, off by default in **Preferences…**): categorize card interest to *Credit Card Interest* and it stays out of your plan, showing as card debt to cover, as YNAB is starting to do.

## 9. Loans

Loan accounts (Mortgage, Auto Loan and the rest) track what you owe outside the plan.

- **Add loan details** (or the gear in the sidebar) records the interest rate, minimum payment, escrow and fees. HAFB then posts each month's interest, escrow and fees on the 1st. You can edit or delete a posted charge like any transaction; a deleted one isn't posted again.
- **Get Started** pairs the loan with a category for its payments. Payments then come from that category, **Record Payment** appears, and the category's target becomes a Monthly Debt Payment that shows when the loan will be paid off.
- **Open Payoff Simulator** shows the payoff date and interest for a different monthly payment, or the payment needed to finish by a date, plus a one-time extra payment (**Interest Savings**, **Time Savings**; **Reset all changes** goes back).
- Loans never close themselves at zero. Paying one off is celebrated.

## 10. Importing from your bank

HAFB never connects to your bank. Download a file from your bank's website and choose **File Import** in the account's register.

- **Formats:** CSV, OFX and QFX (several files at once), and QIF.
- **CSV:** pick which column is which once; HAFB detects the delimiter, date order and decimal mark, and remembers the mapping for that account.
- **Import Transactions** lists what will happen to each row before anything changes: new, matched to one you entered, or skipped (already imported, rejected before, or more than 3 days older than your last reconciliation).
- Imported transactions arrive unapproved: check them, then **Approve** (`A`), or **Reject** (Shift+R) one that shouldn't be there; it never comes back. Unapproved transactions still count in your plan.
- **Matching:** a transaction you entered, or a scheduled one, matches an import with the same amount within 10 days. The bank's amount wins; your payee, memo and date stay. **Match** (`M`) and **Unmatch** (Shift+U) do it by hand.
- **Payee names:** HAFB cleans up the bank's names. Change an imported payee and HAFB remembers it for future imports of that bank text; **Manage Payees** lists those renaming rules. **Bank Import Details** (right-click) shows what the bank sent, and **Don’t rename as** (with the payee's name) keeps the bank's name from then on.

## 11. Reconciling

Reconcile an account against your bank statement now and then. **Reconcile** (Shift+E) asks whether your current cleared balance matches what your bank shows.

- **Yes:** every cleared transaction is locked as reconciled.
- **No:** enter the **Current balance at your bank** and choose **Next**. A banner says how far apart they are. Look for missing, duplicated or uncleared transactions first; if you can't find the difference, **Create Adjustment & Finish** adds a *Reconciliation Balance Adjustment* and reconciles.

The register header then says when you last reconciled. Editing a reconciled transaction asks first, and clicking a lock unlocks just that one.

## 12. Payees

**Manage Payees…** (plan menu, or under the payee list) lists every payee, with transfer payees separately. Select payees to rename, combine (merge into one), hide (not suggested while typing) or delete them. A payee's settings choose its category: learned from use (it changes when two of the last three transactions agree), a fixed default, or none. Renaming rules there rename imported payees; YNAB's *is* and *contains* rules are both supported.

## 13. Reflect

**Reflect** in the sidebar has five reports:

- **Spending Breakdown:** where the money went, by category or group, with any categories that took in more than they spent.
- **Spending Trends:** spending per month, stacked by group, with the average.
- **Net Worth:** assets against debts each month.
- **Income v Expense:** income and spending per month, with averages and totals.
- **Age of Money:** how long a dollar waits between arriving and being spent (it needs 10 outflows first).

Pick the dates, categories and accounts at the top; they're remembered per plan. Click any figure to see its transactions, and a transaction to open it in its register. **Export** saves the report as CSV (TSV for currencies with a decimal comma) or a chart as a PNG. **Share Your Progress** (Net Worth) makes an image you can share, with the amounts hidden if you like.

## 14. Settings

- **Plan Settings…** (stored in the plan file): **Plan Name**, **Currency** (160 currencies), **Currency Placement**, **Number Format**, **Date Format**, and **Password**. Changing to a currency with other decimals changes only what shows; amounts are kept. Undo works.
- **Display Options…**: **Theme** (**Default**, **Dark**, **Match System**, **High contrast**), **Progress Bars** and **Balance Style** (**Differentiate Without Color**).
- **Preferences…** (Ctrl+, ; stored on this PC): **Text size** (90–200%; Ctrl+= and Ctrl+- too), **Keyboard shortcuts** on or off, **Hide amounts**, the early Credit Card Interest category, the **Default account** for new transactions in All Accounts, and the **Plans folder** where Open and Save start.
- **Use Windows title bar** (sidebar **View options**) swaps HAFB's title bar for the standard Windows one.

## 15. Backups, copies, exports and Fresh Start

- **Backups…:** HAFB backs a plan up every time you open it and before any file update, keeping the newest 10 (choose 3 to 100) in a folder you can change. **Back up now** makes one; **Restore** puts the plan back as it was, after backing up the plan as it is now.
- **Save a copy…** writes a duplicate anywhere.
- **Export for YNAB (CSV)…** writes YNAB's own `Plan.csv` and `Register.csv` in a zip.
- **Add categories from a template…** adds a ready-made set of groups and categories at the bottom. Nothing is overwritten.
- **Make a Fresh Start…** begins a new plan from today. It keeps your accounts (at a $0 balance for you to update), category groups, categories, targets, scheduled transactions, payees and expected income. The old plan stays where it is, renamed "(Archived on …)", with all its history.

## 16. Locking a plan with a password

**Plan Settings…** → **Set a password…** locks the plan file with SQLCipher (AES-256), so other programs can't read it. It stays a standard file: *DB Browser for SQLite* (its SQLCipher edition) opens it with the password.

- Opening a locked plan asks for its password. **Remember on this PC** keeps it in Windows Credential Manager, never in the file.
- **Change password…** and **Remove password…** offer to change this plan's backups too, so there's one password to remember.
- **A forgotten password can't be recovered.** Not by HAFB, not by anyone.

## 17. Undo, keyboard and accessibility

- **Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z or Ctrl+Y) cover every change, one step at a time; a toast says what was undone.
- Every YNAB keyboard shortcut works, plus Windows ones. Press `?` or F1 for the list, or see [shortcuts.md](shortcuts.md).
- HAFB works with a keyboard alone, with Narrator, at 200% text size and with Windows contrast themes ([accessibility.md](accessibility.md)).

## 18. When something goes wrong

- **"Windows protected your PC"** when installing: see [install.md](install.md). HAFB's downloads aren't code-signed yet.
- *A plan is damaged* (a disk fault, a sync conflict): HAFB checks every plan as it opens and won't open a damaged one. It offers its newest good backup instead, and keeps the damaged file in the backups folder.
- **"This plan was saved by a newer version of the app"**: install the newer HAFB, or restore a backup made before it was upgraded.
- *The plan is open in another window:* switch to that window, or close it first.
- *Something looks wrong with your numbers:* Undo, check Recent Moves, then Reflect's drill-downs show which transactions make up a figure.

Your data lives in your plan files, plus `%LOCALAPPDATA%\app.hafb.desktop` for backups, the recent list and settings (or the `HAFB Data` folder for the portable version).
