# YNAB trial scenario: verifying the open engine rules

**Purpose:** settle the open questions in `docs/budget-math.md` §13 with YNAB's own numbers.
- HAFB's predictions for every value below were **computed and frozen before you enter anything**, in `packages/engine/test/__snapshots__/trialScenario.test.ts.snap`. Your numbers will be compared with them, not used to tune them. You don't need to look at the predictions.
- **Time:** about 30–40 minutes. Do the parts in order, and type amounts exactly as shown.

> If something on screen doesn't match these instructions (a button name, an extra prompt), just do the closest thing and note it. Differences from what we expected are useful too.

## Part 1: Accounts (sidebar → Add Account → "Add an unlinked account")

Keep your existing **bank** account. Its $1,000.00 starting balance is part of the scenario.

1. **Check `bank`:** open it, click Edit (pencil) and note its **account type**. Also note the **date** on its "Starting Balance" transaction.
2. Add these accounts:

| Name | Type | Balance |
|---|---|---|
| **Visa** | Credit Card | $0.00 |
| **Amex** | Credit Card | $0.00 |
| **Mortgage** | Mortgage (loan) | Owed **$200,000.00**; interest rate **6.00%**; monthly payment **$1,500.00**. If it asks for escrow: **$300.00**. If it asks to create a category for payments: **skip / no**. |

## Part 2: Categories

Use these existing categories, and **rename nothing**: Groceries, Dining out, Transportation, Rent/Mortgage, Phone & Internet, Utilities, Entertainment, Vacation, Emergency fund.

Add a category group **Test Group** (keep names generic; never use the project name in YNAB) containing three new categories: **Gifts**, **Car Fund**, **House Down Payment**.

Make sure **no other category has a target**: Medical expenses, Stuff I forgot to plan for, YNAB subscription.

## Part 3: Targets (click a category → Target → Create Target)

| Category | Cadence | Amount and date | "Next month / next period I want to…" | Extra |
|---|---|---|---|---|
| Groceries | Weekly | $100.00, every **Saturday** | **Refill up to** | |
| Dining out | Monthly | $100.00, by **end of month** | **Set aside another** | |
| Transportation | Monthly | $150.00, by the **15th** | **Refill up to** | |
| Phone & Internet | Monthly | $60.00, by the **22nd** | **Set aside another** | |
| Entertainment | Monthly | $20.00, by the **1st** | **Set aside another** | then **Snooze** it for October |
| Gifts | Yearly | $600.00 by **Dec 10, 2026** | **Refill up to** | |
| Vacation | Custom | $1,200.00 due **Jun 1, 2027**, Repeat **off** | **Set aside** | |
| Car Fund | Custom | $300.00 due **Feb 1, 2027**, Repeat **on, every 6 months** | **Set aside another** | |
| Emergency fund | Custom | $1,000.00 due **Mar 1, 2027**, Repeat **off** | **Have a balance of** | |
| House Down Payment | Custom | $5,000.00, **no due date** if allowed (otherwise note what it forces) | **Have a balance of** | |

Leave Utilities **without** a target.

## Part 4: Transactions (open each account → Add Transaction; dates are in 2026)

**bank** (inflows go to *Ready to Assign*; use any payee names):

| Date | Payee | Category | Outflow | Inflow |
|---|---|---|---|---|
| Oct 1 | Employer A | Ready to Assign | | 500.00 |
| Oct 2 | Employer B | Ready to Assign | | 1,000.00 |
| Oct 4 | Employer C | Ready to Assign | | 3,000.00 |
| Oct 3 | Grocer | Groceries | 120.00 | |
| Oct 5 | Gas Station | Transportation | 200.00 | |
| Oct 6 | Store | **Split:** Groceries 60.00 + Phone & Internet 30.00 | 90.00 | |
| Oct 6 | Payee: **Transfer : Visa** (a credit card payment) | — | 50.00 | |
| Oct 7 | Landlord | Rent/Mortgage | 1,200.00 | |
| Oct 8 | Streaming Co | Entertainment | 15.00 | |
| Oct 8 | Grocer | Groceries | 25.00 | |
| Oct 8 | Grocer | Groceries | 10.00 | |
| Oct 8 | Phone Co | Phone & Internet | 5.00 | |
| Oct 8 | Gas Station | Transportation | 35.00 | |

**Visa:**

| Date | Payee | Category | Outflow | Inflow |
|---|---|---|---|---|
| Oct 3 | Restaurant | Dining out | 80.00 | |
| Oct 7 | Restaurant (refund) | Dining out | | 20.00 |

**Amex:**

| Date | Payee | Category | Outflow | Inflow |
|---|---|---|---|---|
| Oct 5 | Cafe | Dining out | 50.00 | |

**Scheduled:** in **bank**, add a transaction dated **Oct 20, 2026**, payee Power Co, category **Utilities**, outflow **15.00**, set to **Repeat monthly**. It should appear as an upcoming/scheduled transaction.

## Part 5: Assign in October

In **October 2026**, type these in the Assigned column. Assign nothing anywhere else, and **don't use Auto-Assign** yet.

| Category | Assign | | Category | Assign |
|---|---|---|---|---|
| Groceries | 400.00 | | Gifts | 50.00 |
| Dining out | 100.00 | | Vacation | 100.00 |
| Transportation | 150.00 | | Car Fund | 50.00 |
| Rent/Mortgage | 1,200.00 | | Emergency fund | 100.00 |
| Phone & Internet | 60.00 | | House Down Payment | 200.00 |
| Entertainment | 20.00 | | | |

## Part 6: Record what YNAB shows

Screenshots are perfect; full-window is fine. Send them to me as you go, or all at the end.

**October:**
1. The whole **Plan screen for October**: every category's Assigned / Activity / Available. Scroll for a second shot if needed, and include the credit card payment categories (Visa, Amex).
2. Click the **Ready to Assign** amount: the breakdown popover.
3. **Inspector with nothing selected:** the *Available in October*, *Cost to Be Me* and *Auto-Assign* sections, showing the amount beside **Underfunded** and every other option. **Don't click them.**
4. Click each category **with a target** and capture the **Target** card in the Inspector (needed / funded / to go / %, and the "Assign $X" message). That's 10 categories.
5. Click **Utilities** and capture the Inspector (upcoming scheduled $15.00).

**November** (use the → arrow by the month):

6. The Plan screen.
7. The Ready to Assign breakdown popover.
8. The Target card for **Groceries, Transportation, Gifts, Vacation, Car Fund, Emergency fund**.
9. Inspector, nothing selected: the Auto-Assign amounts.

**December:**

10. Click **Phone & Internet**: the Auto-Assign **Average Assigned** amount.

**Reflect** (left sidebar):

11. **Age of Money**, plus the number if it's shown elsewhere.
12. **Spending Breakdown** for **October 2026** only (total and categories).
13. **Income v Expense** for **October 2026**.
14. **Net Worth** (October bar or numbers).

**Mortgage account:**

15. Its header / loan details: payoff date, interest, anything about the monthly interest or payment breakdown.

## Part 7: Export (before Part 8)

Click the plan name (top left) → **Export Plan**. Send me the zip, or put it in `C:\Claude_Projects\HAFB\packages\engine\test\fixtures\local\ynab-trial\`.

**Optional and more precise:** YNAB's API gives every computed number in one file. Create a personal access token in YNAB under **Account Settings → Developer Settings**, then run this in your own PowerShell. Keep the token private and don't paste it to me.

```powershell
$env:YNAB_TOKEN = "<your token>"
$h = @{ Authorization = "Bearer $env:YNAB_TOKEN" }
Invoke-RestMethod https://api.ynab.com/v1/budgets/last-used -Headers $h | ConvertTo-Json -Depth 20 | Out-File -Encoding utf8 C:\Claude_Projects\HAFB\packages\engine\test\fixtures\local\ynab-trial\api-budget.json
```

## Part 8: Fresh Start (last; it archives this plan)

Plan name → **Fresh Start** (or "Make a fresh start"). Accept the defaults. Then capture:

16. The new plan's **Ready to Assign**.
17. The sidebar account **balances** for bank, Visa, Amex and Mortgage.
18. Each account's register: what **starting balance transaction** it got, its **date**, and its **category**.

## Optional extras (only if you have time)

- **Monthly loan interest:** after **Nov 1**, check whether YNAB posted an interest transaction to the Mortgage, and its amount.
- **Changing an account's type:** create a checking account "Converted", add a $50.00 Dining out outflow, then try Edit → change its type to Credit Card. Note whether it's allowed and what the new payment category shows.

## Part 9: Follow-up checks (after the first comparison, 2026-10-08)

The first comparison is done (see `docs/budget-math.md` §12.2). Three checks remain. HAFB's predictions for them are recorded in the session log, made before you check.

1. **Age of Money:** open the **Oct 5 Gas Station** transaction in `bank` and change it from an *inflow* of $200.00 to an **outflow** of $200.00. That gives YNAB its 10th outflow. Then open **Reflect → Age of Money** and note the number of days.
2. **Weekly target rule:** in **October**, change **Groceries' Assigned** from 400.00 to **350.00**. Click Groceries and note the Target card (to go / "Assign $X more" / met). Then set it **back to 400.00**.
3. **Fresh Start (last; it archives the plan):** do Part 8.

I can take the screenshots after each step if you leave the plan open in Chrome.
