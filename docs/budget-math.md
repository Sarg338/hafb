# Budget math: rules and worked examples

This is the companion to CLAUDE.md §5. Every rule has worked examples here, and each example has a test with the same section number in `packages/engine/test/`. Amounts are written in dollars; the engine stores integer cents (CLAUDE.md §1). Code lives in `packages/engine/src/`.

## 0. Conventions and how each rule was verified

- **Months** are calendar months of the plan's local date (`YYYY-MM`). Dates are `YYYY-MM-DD` strings, and all date math uses integer day numbers, never `Date`.
- **Money** is a branded integer (`Minor`). Division happens only in averages, target shares and loan interest:
  - **Averages and interest** round half away from zero (`divRound`).
  - **Target monthly shares** round **up** (ceiling), so a target is reached by its due date.
- **Verification levels** used below:
  - **Golden:** matched against YNAB's own numbers in a real export, to the cent (§12).
  - **YNAB example:** reproduces a number shown in YNAB's help center or screenshots.
  - **Documented:** follows YNAB's written rule; no YNAB numbers to compare.
  - **Assumption:** YNAB is silent. This is our choice, listed in §13 with what would verify it.

## 1. Core identity (CLAUDE.md §5.1)

For every category and month:

```
available(m) = carried(m) + assigned(m) + activity(m)
carried(m)   = max(available(m−1), 0)          ← negative balances never carry
```

`activity` is the sum of the month's transactions in that category, across on-budget (Cash and Credit) accounts. A split contributes each line to its own category. Deleted transactions are ignored. On-budget money with no category gets a pseudo-category, **Uncategorized**, which follows the same rules.

**Verification:** golden. All 2,958 rows of the export satisfy this identity, including 186 months that ended negative, every one of which carried as 0.

| Ex. | Setup | Result |
|---|---|---|
| 1.1 | Assign $400 to Groceries, spend $150 cash | Available $250; Ready to Assign drops by $400 |
| 1.2 | Next month assign $100, spend $50 | Carried $250, Available $300; the month after carries $300 |
| 1.3 | Instead, spend $350 in month 1 (assigned $400, spent $150 + $350) | Available −$100, all **cash** overspending. Month 2: Groceries carries **0**, and Ready to Assign is $100 lower, **in month 2, not month 1** |
| 1.4 | $25 refund to Groceries | Activity −$125 (refunds net against spending) |
| 1.5 | Split: $60 Groceries + $40 Rent | Each category gets its line; a split that doesn't sum to its parent is an `InvariantViolation` |
| 1.6 | $10 outflow with no category | Uncategorized: −$10, and it counts as cash overspending |

## 2. Ready to Assign (CLAUDE.md §5.2)

```
RTAcore(m)        = RTAcore(m−1) + inflows(m) − assigned(m) − cashOverspending(m−1)
assignedInFuture  = min( Σ assigned(k) for every k > m , max(0, RTAcore(m)) )
ReadyToAssign(m)  = RTAcore(m) − assignedInFuture(m)
```

- **Future assignments never take a month below zero** (verified in the YNAB trial, 2026-10-08). With $3,070 left in October and $3,500 assigned in November, October shows **$0.00 All Money Assigned**, with "Assigned in Future −$3,070.00" (capped, not −$3,500). November shows −$430.00. When October is itself over-assigned (core −$930), it shows −$930.00 and no future line. YNAB marks the inspector's *Assigned in Future Months* with a warning triangle while a future month is negative.
- Not yet distinguished: whether a future month's own inflows offset its assignments when seen from an earlier month. Future-dated inflows don't exist in YNAB (they're scheduled), so this only matters when looking back at past months.

- `inflows(m)` are transactions categorized **Inflow: Ready to Assign** in on-budget accounts. This includes starting balances, and inflows on credit cards (§3.10).
- The breakdown shown to the user is *left over from last month* (RTAcore(m−1)), *cash overspending last month*, *inflows*, *assigned this month* and *assigned in future*.
- **D11 (verified):** the "Ready to Assign Breakdown" popover lists only the non-zero lines, grouped as a + block (*Inflow: Ready to Assign transactions in October*) and a − block (*Assigned in October*, *Assigned in Future*), then *Total Ready to Assign* with a line of encouragement ("Give these dollars a job…", "Nice work! Every dollar has a job.", or "You have assigned more than you have.").

**Verification:** documented, plus the identity in §5. The export doesn't contain Ready to Assign.

| Ex. | Setup | Result |
|---|---|---|
| 2.1 | Jan: $1,000 in, assign $300. Feb: $500 in, assign $200 | Jan shows **$500** (Feb's $200 is "assigned in future"); Feb shows $1,000 (left over $700 + $500 − $200) |
| 2.2 | Jan: $1,000 in, assign $300 in Jan and $250 in April | Jan–Mar show $450 (assigned in future $250); April shows $450 with $250 assigned this month |
| 2.3 | $100 in, assign $150 | −$50: negative Ready to Assign is allowed |
| 2.4 | Starting balances $1,200 checking + $300 savings; a $400,000 house (asset, off-budget) | $1,500. Off-budget accounts never count |
| 2.5 | October core $3,070; $3,500 assigned in November | October **$0.00** (assigned in future $3,070, capped); November −$430 |
| 2.6 | October core −$930; $3,500 assigned in November | October −$930 (assigned in future $0); November −$4,430 |

## 3. Credit cards (CLAUDE.md §5.3)

Each on-budget credit account (credit card or line of credit) has exactly one **payment category**. For every regular category and month:

```
creditSpending = Σ over cards of max(−net card activity in the category, 0)
if available < 0:
    creditOverspending = min(−available, creditSpending)    ← credit first
    cashOverspending   = −available − creditOverspending
funded(card) = −net card activity − unfunded share           ← moves into the payment category
```

Payment category: `activity = Σ funded spending − payments`, where a payment is the card leg of a transfer from an on-budget account. A payment category that goes negative is cash overspending.

- **3.1–3.2 Month rollover.** Credit overspending resets to 0 like any overspending, but it does **not** reduce Ready to Assign. It stays as card debt the payment category doesn't cover.
  - *Correction (2026-10-08):* CLAUDE.md used to say credit overspending carried forward as a negative. YNAB's docs and the golden data both say it resets.
- **3.3 Which spending goes unfunded.** When several cards or card transactions share an overspent category, the unfunded part is the **most recent card outflows first** (last in, first out; same-day ties go to the later entry).
  - **Verification:** golden. This beat "month-level, whole card by most recent date" and a chronological running-balance model, and resolved every case where two cards share an overspent category.
- **Verification overall:** golden. Payment categories for 5 of the export's 6 cards match in all but a few months; see §12 for the exceptions.

| Ex. | Setup (Dining assigned $100) | Result |
|---|---|---|
| 3.1 | $60 on Visa | Dining $40; Visa payment +$60 |
| 3.2 | $160 on Visa | Dining −$60 **credit** overspending; payment $100; next month Dining carries 0 and Ready to Assign is unchanged; Visa owes $160 with $100 set aside |
| 3.3 | $70 cash + $50 Visa | −$20 → credit $20, cash $0; Visa funded $30 |
| 3.4 | $150 cash + $20 Visa | −$70 → credit $20, cash $50; Visa funded $0 |
| 3.5 | $60 on Visa, then a $15 refund on Visa | Dining $55; payment $45 |
| 3.6 | $60 on Visa, then pay $80 from checking | Payment −$20 → cash overspending, next month's Ready to Assign −$20 |
| 3.7 | $50 cash advance (Visa → checking) | Payment category +$50 (the cash is now there to repay it) |
| 3.8 | $80 Visa on the 3rd, $60 Amex on the 25th | −$40 credit; Amex (most recent) unfunded first → Amex funded $20, Visa $80 |
| 3.9 | Line of credit | Behaves like a card |
| 3.10 | $25 inflow on Visa categorized to Ready to Assign | Ready to Assign +$25; payment category unchanged |


### 3.12 A card's starting debt (verified in the YNAB trial, 2026-10-08)

- **Observed:** adding a credit card that owes $100 (YNAB reads the entered 100 as owed and shows −$100.00):
  - Ready to Assign stayed at **$3,070.00**.
  - The Starting Balance showed **Category not needed**.
  - The new payment category showed $0.00 with the yellow underfunded alert.
  - Auto-Assign → Underfunded grew by exactly **$100**.
- **Rule:** a card's negative starting balance stays off the plan. It doesn't touch Ready to Assign or any category; it only sets the card's balance, which the payment category then shows as underfunded. YNAB's export may still label it *Inflow: Ready to Assign* (it does for $0), so the engine ignores the category on a negative card starting balance.
- **Positive balance:** a card that starts with a credit in your favour is cash-like (YNAB: "the positive balance is treated like cash and added to Ready to Assign"), so its starting balance is an inflow.
- **Tests:** `budget.test.ts` 3.12 and 3.13. *Correction:* earlier rules (and CLAUDE.md §5.2) said a negative card starting balance was an outflow from Ready to Assign.

## 4. Transfers (CLAUDE.md §5.9)

| Ex. | Transfer | Effect |
|---|---|---|
| 4.1 | Checking → savings (both on-budget) | No category; no budget effect. A category here is a `ValidationError` |
| 4.2 | Checking → mortgage (off-budget), categorized Housing | Housing −$1,500 (spending) |
| 4.3 | Brokerage (off-budget) → checking, categorized Ready to Assign | Inflow +$200 |
| — | Checking → card | A payment (§3.6). Card → checking is a cash advance (§3.7) |

## 5. The reconciliation identity (property test)

For every month, whatever the transactions:

```
RTAcore(m) + Σ available(m) = cash-account balances(m) + Ready-to-Assign inflows on cards(≤ m) − creditOverspending(m)
```

- **What it guarantees:** every dollar is either in an account or explained as card debt not yet covered, so the math can't leak or double count.
- **How it's tested:** `identity.test.ts` checks it for every month of 400 random plans. They include splits, refunds, transfers in every direction (card↔card, cash advances, off-budget), negative assignments and assignments in future months.

## 6. Targets (CLAUDE.md §5.4)

A target is a **cadence** (weekly / monthly / yearly / custom ± repeat) plus a **behavior** (*Set aside another*, *Refill up to*, *Have a balance of*). YNAB publishes the behaviors but not the formulas. The model below reproduces every numeric YNAB example found.

**Weekly and monthly** (one month per period). Weekly `needed` = amount × the number of times the weekday occurs in the month.

| | Set aside another | Refill up to |
|---|---|---|
| funded | assigned this month | left over + assigned this month |
| needed this month | needed | needed − left over |
| underfunded | needed this month − assigned | same |

**Multi-month** (yearly, custom, Have a balance of). With *r* = months left in the period including this one:
- **Set aside another:**
  - `funded` = everything assigned in this period so far.
  - `neededThisMonth = ⌈(amount − assigned in earlier months of the period) / r⌉`.
- **Refill up to / Have a balance of:**
  - `funded` = left over + assigned this month.
  - `neededThisMonth = ⌈(amount − left over) / r⌉`.
- **Have a balance of, no date:** `neededThisMonth = amount − left over`.

**Status and other rules.**
- **Status, in priority order:** snoozed → overspent → underfunded → funded (funded ≥ needed) → on track.
- `progressPercent = ⌊100 × funded / needed⌋`.
- `overfunded = assigned − neededThisMonth` when positive.
- **Inactive:** a non-repeating target is inactive after its due month, and before the month it was created.
- **Cost to Be Me** = Σ neededThisMonth of active targets, compared with expected income.

| Ex. | Target and month | Result | Verification |
|---|---|---|---|
| 6.1 | Refill up to $100/week (Saturdays), Feb 2026 (4 Saturdays), $50 left over, $100 assigned | needed $400, funded $150, to go $250, underfunded $250, **37%** | YNAB example |
| 6.2 | Same with Set aside, Jan 2026 (5 Saturdays) | needed $500 | YNAB doc ("occurs five times") |
| 6.3 | Monthly Set aside $100 by the 15th; $80 left over, $60 assigned | funded $60 (leftovers don't count), underfunded $40 | Documented |
| 6.4 | Monthly Refill up to $100; $50 left over + $50 assigned | funded $100, met, 100% | YNAB example |
| 6.5 | Set aside $300 every 6 months by Feb 1 2027, created Sep 2026 | Sep: assign **$50** (6 months left); Oct after $50: still $50; Mar 2027: next period due Aug 2027 | YNAB example |
| 6.6 | Refill up to $1,200/year by Sep 1 2027, Oct 2026, $100 left over | **8%**, to go $1,100, needed this month ⌈1,100/12⌉ = $91.67 | YNAB example |
| 6.7 | Have a balance of $10,000 by May 2027 with $1,111.12 | **11%**, to go $8,888.88 | YNAB example |
| 6.8 | Snoozed this month | underfunded 0 this month only | Documented |

**Corrected and confirmed by the YNAB trial (2026-10-08, §12.2):**
- **Have a balance of, no date:** shows progress and to go, but `neededThisMonth = 0` and no "Assign" prompt; it's excluded from Cost to Be Me.
- **Weekly targets:** in the month a target is created, due days before its creation date need no funding. Example: Groceries, created Thu Oct 8 with $400 assigned against 5 Saturdays. YNAB shows *Needed $500, Funded $400, To go $0, met*.
  - Confirmed by a follow-up: with $350 assigned, YNAB asks for $50 more (4 remaining Saturdays × $100 − $350).
- **Refill up to, viewed in a future month:** leftover money is ignored. November shows Groceries *Funded $0.00* despite $185 left over (YNAB's API docs say the same). Yearly refill targets still count it.
- **Status:** overspending isn't a target status. An overspent category whose assignment meets its target shows the target as met.
- **Cost to Be Me** = full weekly/monthly amounts + this month's share of multi-month targets. No-date balances are excluded and snoozed targets included: **$1,390.01** exactly.
- **Rounding:** multi-month shares round **up**. Confirmed by the .01 in Cost to Be Me (Vacation $133.34).
- **Confirmed unchanged:** set aside / refill / have-a-balance formulas, months remaining, and progress %. All 19 cards matched in October and November.

## 7. Plan operations (CLAUDE.md §5.5, §5.6, §5.14)

Every operation is pure. It returns assignment deltas and their total (the amount of Ready to Assign it uses), so the UI can preview it and commit it as one undo step.

- **7.1 Move money:** between categories, or to and from Ready to Assign, within a month. The categories net to zero.
- **7.2 Cover overspending:**
  - It can draw from the same month, or from money assigned in a **future month** (YNAB, Jun 2025); Ready to Assign is unchanged.
  - It can't cover more than the overspending or draw more than a future month holds.
  - Covering *credit* overspending funds the card spending, which then flows into the payment category.
- **7.3 Auto-Assign:**
  - **Assigned / Spent Last Month:** set this month's assigned to last month's assigned, or to last month's net spending.
  - **Average Assigned / Average Spent:** averages over up to the previous 12 months the plan has, rounded half away from zero. Example: (100 + 0 + 1) / 3 = 33.67 → 34.
  - **Reset Available:** assigned −= available, so Available becomes 0.
  - **Reset Assigned:** assigned = 0.
  - **Reduce Overfunding:** removes `overfunded`, but no more than was assigned this month.
  - **Underfunded:** follows YNAB's documented priority and stops when Ready to Assign reaches 0.
    - Priority: overspent categories, then weekly targets and monthly targets with a due day (by due date), then end-of-month targets, then future-dated targets (by due date), then credit card payment categories. Ties go in category order.
    - "Have a balance of" targets with no date are skipped.
    - Example: with $2,130 to assign, overspent food $100 → rent $1,500 → fun $200 → gifts $120. With only $130: food $100, rent $30, stop.
- **7.4 Plan Reset:**
  - Current month: every non-payment category's Available is brought to 0. Positive balances return to Ready to Assign; overspending is covered.
  - Every future month's assignments return too.
  - Payment categories are never drawn from, but covered credit overspending does flow into them.
- **7.5 Fresh Start** (verified on YNAB, trial 2026-10-08):
  - The new plan keeps category groups, categories, targets, scheduled transactions and every open account.
  - Accounts that aren't bank-linked (every HAFB account) restart at **$0**: one $0 "Starting Balance" transaction dated today, categorized to Ready to Assign. The user then enters today's balance.
  - Ready to Assign starts at $0. The old plan is archived unchanged.
  - The carried-over targets reproduce YNAB's numbers in the new plan: Underfunded $1,305.01, Cost to Be Me $1,390.01, next month $1,455.00.

**Corrected and confirmed by the YNAB trial (§12.2):**
- **Spent Last Month / Average Spent:** use −activity **with its sign**; a category with net inflow counts negative. They skip credit card payment categories. November: **$1,410.00**.
- **Options that look back:** with no earlier month in the plan, Assigned/Spent Last Month and the averages do nothing (all **$0.00** in October). Averages use the months the plan has (November Average Assigned = October's **$2,430.00**).
- **Underfunded:**
  - It includes a scheduled bill with no target (Utilities $15) and covers overspending first.
  - A credit card payment category adds its uncovered card debt minus this month's credit overspending. Amex owes $50 with $40 set aside: **$0** in October (Dining out's $10 is already counted as overspending), **$10** in November.
  - Totals: **$285.01** (Oct) and **$1,395.00** (Nov), both exact.
  - **The preview is the full need**, even when Ready to Assign can't cover it: the fresh plan showed $1,305.01 with $0 to assign. Committing goes through `limitToReadyToAssign`, which stops when the money runs out, in priority order (YNAB's Underfunded guide).
- **Reset Available / Reset Assigned** act only on selected categories; with nothing selected YNAB shows $0.00. That's a UI scope rule.

**Verification:** YNAB trial for Auto-Assign and Cost to Be Me. Move money, cover overspending, Plan Reset and Fresh Start: documented, plus end-to-end tests.

## 8. Transaction logic (S1.6)

These are the worked examples behind `packages/engine/src/{scheduled,reconcile,search,payees}.ts`. Each example has a matching test in `packages/engine/test/`. Amounts are written in dollars here; the code works in cents. Rules that YNAB doesn't document are marked **Assumption** and cite their source.

### 8.1 Scheduled transactions (CLAUDE.md §5.11, `scheduled.ts`)

**Recurrence** (`nextOccurrence`). There are 13 frequencies.

| Frequency | Step | Example: from → next |
|---|---|---|
| never | (one time) | 2026-03-10 → none |
| daily / weekly / everyOtherWeek / every4Weeks | +1 / +7 / +14 / +28 days | 2026-12-20 (every4Weeks) → 2027-01-17 |
| monthly / everyOtherMonth / every3Months / every4Months | +1 / +2 / +3 / +4 months | 2026-11-10 (everyOtherMonth) → 2027-01-10 |
| twiceAYear / yearly / everyOtherYear | +6 / +12 / +24 months | 2026-01-01 (yearly) → 2027-01-01 |
| twiceAMonth | the anchor day, then exactly 15 days later | 5th → 20th → next 5th |

- **Month-end clamping.** A schedule created on the 31st repeats on the last day of shorter months and returns to the 31st afterwards. The schedule keeps an `anchorDay` for this: Jan 31 → Feb 28 → Mar 31 → Apr 30. With anchor day 29, Feb 29 2024 → Feb 28 2025, and every other year → Feb 29 2028. Source: [YNAB scheduled transactions guide](https://support.ynab.com/en_us/scheduled-transactions-a-guide-BygrAIFA9), "it will repeat on the last day of shorter months".
- **Twice a month.** YNAB says the second date is "15 days later … regardless of the month's end".
  - Anchor 20th → Mar 20 → **Apr 4** → Apr 20.
  - Anchor 31st → Feb 28 → Mar 15 → Mar 31.
  - **Assumption:** the first date of each month is the anchor day clamped to the month's length. YNAB documents only the 5th/20th example.
- **YNAB quirk not reproduced.** YNAB says the 31st rule only works "if you create the schedule during a month with 31 days". HAFB applies the rule whenever `anchorDay` is 31.

**Entering due transactions** (`dueTransactions`, roadmap D3). Every occurrence dated on or before `today` becomes a real transaction. There's no review prompt.
- New transactions are unapproved (`approved: false`) and `uncleared`. In accounts of type **cash** they're created `cleared`, as YNAB's guide says. **Assumption:** this is limited to the `cash` type; checking and savings stay uncleared.
- Ids are `<scheduleId>:<date>`, and split lines are `<subId>:<date>`. The engine never makes random ids.
- *Example 8.1.1:* a monthly rent of −1,000.00 starting 2026-01-31, run on 2026-03-31, creates Jan 31, Feb 28 and Mar 31. The schedule's next date becomes Apr 30.
- *Example 8.1.2:* a one-time (`never`) schedule creates its transaction, and its next date becomes `null` (used up).

**Upcoming shortfall** (`upcomingByCategory`, `availableAfterUpcoming`, `upcomingShortfalls`).
- Scheduled amounts still to come in a month count from after `today` (or from the 1st, for a future month) through the month's end. Each category gets a signed total; split lines count toward their own categories. Scheduled transactions never change the plan itself.
- *Example 8.1.3:* today is Mar 15. Bills has 50.00 available and a phone bill of −60.00 due Mar 25. Fun has 30.00 available, a gym charge of −20.00 on Mar 26, and a refund of +10.00 on Mar 20. Available after upcoming: Bills −10.00 (shortfall, shown with YNAB's calendar icon), Fun 20.00.

### 8.2 Reconciliation (CLAUDE.md §5.8, `reconcile.ts`)

- **Cleared balance** = the sum of the account's live `cleared` and `reconciled` transactions dated on or before the statement date.
- `difference = statement − cleared balance`.
- **Zero difference:** every `cleared` (not yet reconciled) transaction dated on or before the statement date is locked as `reconciled`.
- **Non-zero difference:** an adjustment of exactly `difference` is created and reconciled along with the rest.
  - Payee: "Reconciliation Balance Adjustment".
  - Category: Ready to Assign in on-budget accounts, none in off-budget ones.
  - Id: `reconcile:<account>:<date>`.

| Example | Register (checking) | Statement on Mar 15 | Result |
|---|---|---|---|
| 6.2.1 | +1,000.00 reconciled; −200.00 cleared; −50.00 uncleared; −30.00 cleared on Mar 20 | 800.00 | Cleared balance 800.00, difference 0; lock the −200.00 |
| 6.2.2 | same | 792.50 | Difference −7.50 → adjustment −7.50 to Ready to Assign; lock the −200.00 and the adjustment |
| 6.2.3 | House (off-budget) 300,000.00 cleared | 290,000.00 | Adjustment −10,000.00, uncategorized |

Reconciled transactions warn before they're edited (`canEditWithoutWarning` = false).

### 8.3 Register search (roadmap D9, `search.ts`)

Source: [Searching transactions](https://support.ynab.com/en_us/searching-transactions-a-guide-r1gxyQryj).

- **Combining criteria:** comma-separated, and **all** must match. YNAB calls search "additive, but not subtractive": there's no exclusion (`Except:` is an error) and no wildcards.
- **Case and spacing:** keys and values are case-insensitive. Spacing inside a value must match exactly (`weekly  shop` ≠ `weekly shop`).
- **Documented criteria:**
  - `Payee: Transfer`. Transfers display as "Transfer : *Account*".
  - `Category: Dining Out`, and `Category: Split` for split transactions.
  - `Outflow: >=30`, `Flag is: Red`, `is: uncleared`.
  - Before / After / On a date, in the plan's date format; ISO dates are always accepted.
  - Cleared, Uncleared, Reconciled, Unreconciled, Matched, Approved, Unapproved, Inflow, Outflow.
- **Example:** `Category: Dining Out, Outflow: >=30` matches a −30.00 dining transaction and a split with a dining line.

Assumptions, where the article is silent:
- **Extra keys:** `Memo:`, `Account:` and `Amount:` (either direction) are accepted.
- **Amount operators:** `>`, `<`, `<=` and `=` are accepted; only `>=` is documented. Amounts compare magnitudes, are parsed as text (no floats), and can't use thousands separators, because commas separate criteria.
- **Dates:** `After:` and `Before:` are inclusive. YNAB's own UI label is "On or after", per [duplicate-imports article](https://support.ynab.com/en_us/my-transactions-are-importing-more-than-once-ByyZUaPge); "Before" is inclusive by symmetry.
- **Cleared:** means exactly cleared, since Reconciled is a separate filter.
- **Text matching:** a substring match, not equality.
- **Free text:** matches payee, category, memo or account names, including split lines. If it looks like an amount, it also matches that exact magnitude: `20` finds a 20.00 split line.
- **Flags:** `Flag is:` accepts a color or the user's custom flag name.
- **Uncategorized:** `Category: Uncategorized` (and the `uncategorized` keyword) mean no category, not a split, not a transfer.

### 8.4 Payees (CLAUDE.md §5.13, `payees.ts`)

**Default category** (`nextDefaultCategory`): it changes only when 2 of the payee's 3 most recent categorized transactions agree. YNAB's source: [file-based import elevated](https://www.ynab.com/whats-new/file-based-import-elevated).

| Example | Payee default | Last three (oldest → newest) | New default |
|---|---|---|---|
| 6.4.1 | Groceries | Groceries, Groceries, Household | Groceries |
| 6.4.2 | Groceries | Groceries, Household, Household | **Household** |
| 6.4.3 | Groceries | Gifts, Fun, Dining | Groceries (no two agree) |
| 6.4.5 | none | Ready to Assign | Ready to Assign |
| 6.4.6 | Groceries, pinned | Fun ×3 | Groceries |

- **Counted transactions:** live, non-split, non-transfer transactions of this payee that have a category (Ready to Assign counts).
- **Ordering:** by date. For same-day ties, later in the list counts as more recent.
- **Pinned and switched-off payees:** a pinned default (`defaultCategoryFixed`) never moves, and `autoCategorize: false` suggests nothing.
- **Assumption:** a payee with no default yet takes its most recent category.

**Rename rules** (`applyRenameRules`):
- Matching is *contains*, *starts with* or *equals*, case-insensitive, with spaces significant. The first rule in list order wins.
- *Example:* "AMZN Mktp US*2K4L" matches *starts with* "AMZN" → Amazon.

**Rule proposal** (`proposeRenameRule`, the "Rename all future 'AMZN*' to 'Amazon'?" prompt). **Assumption:** this is HAFB's own heuristic, since YNAB doesn't document one.
- If the name has a store or reference code (its first digit or `#`), propose *starts with* the text before it, provided that text has at least 4 letters: "KROGER #1234" → starts with "KROGER".
- Otherwise, propose *equals* the whole name. "SQ *BLUE BOTTLE" → equals, so "SQ" never captures every Square merchant.

## 9. Age of Money (CLAUDE.md §5.7)

**Verification status: model, not verified.**
- YNAB does not publish its Age of Money algorithm, and the golden export contains no Age of Money values. So nothing in this section has been checked against real YNAB numbers yet.
- Rules come from YNAB's help article ([Age of Money](https://support.ynab.com/en_us/age-of-money-H1ZS84W1s)) and its blog, which says the oldest money is spent first ([How old is your money?](https://www.ynab.com/blog/how-old-is-your-money)).
- Every **ASSUMPTION** below is ours. Verify each one with the YNAB-trial scenario (roadmap S1.7 optional input) before calling this rule done.

### Rules

1. **Money in.**
   - Inflows to Ready to Assign in on-budget cash accounts (checking, savings, cash) go into a first-in, first-out queue of dated "buckets".
   - An off-budget → on-budget transfer categorized to Ready to Assign counts as money in.
   - **ASSUMPTION:** refunds into spending categories don't count as new money.
   - **ASSUMPTION:** a positive starting balance enters the queue.
2. **Money out.**
   - Every outflow from an on-budget cash account counts, *except* transfers to other on-budget cash accounts and starting balances (YNAB: "Transfers and starting balances aren't considered").
   - **Credit card payments count**, but card purchases don't (YNAB).
   - A split transaction is one outflow: the sum of its qualifying lines.
3. **Starting balance:** by default, an account's first transaction when it is an inflow to Ready to Assign. Callers can pass an explicit set instead (e.g. the payee is "Starting Balance").
4. **Order:** events are processed by date. **ASSUMPTION:** on a given day, inflows come first, so same-day income can be spent that day.
5. **An outflow's age** is the amount-weighted average number of days between the buckets it consumes (oldest first) and the outflow date.
   - **ASSUMPTION:** spending money that was never received (an overdraft) has age 0 for the unmatched part.
6. **Age of Money** on a date is the average age of the **last 10** qualifying outflows up to that date (YNAB: 10).
   - **ASSUMPTION:** it's a simple mean, rounded to whole days half up. YNAB says only "on average".
   - It's `null` until there are 10 outflows (YNAB).
7. **Reflect series:** one point per month end; YNAB offers 6-month, 1-year and 2-year ranges. **ASSUMPTION:** month-end points, not daily.

### Example 9.1: FIFO ages and the average

Income: $1,000 on Jan 1 and $1,000 on Jan 15. Then ten outflows of $150 each, on Jan 21 through Jan 30.

| Outflow | Dollars spent | Age (days) |
|---|---|---|
| Jan 21 … Jan 26 | $150 each from the Jan 1 money | 20, 21, 22, 23, 24, 25 |
| Jan 27 | $100 (the last of Jan 1, 26 days) + $50 (Jan 15, 12 days) | (100×26 + 50×12) / 150 = 21.33 |
| Jan 28 … Jan 30 | Jan 15 money | 13, 14, 15 |

Age of Money on Jan 30 = (20+21+22+23+24+25+21.33+13+14+15) / 10 = 19.83 → **20 days**. On Jan 29 there are only nine outflows, so the value is `null`.

### Example 9.2: what counts

- $500 income on Jan 1.
- A $200 Visa purchase on Jan 3: *not counted*.
- $100 checking → savings on Jan 4: *ignored*. It spends nothing and adds nothing.
- A $200 card payment on Jan 10: counted, aged 9 days.
- $100 income on Feb 1, then a $50 outflow the same day: the outflow still spends the Jan 1 money first, so it's aged **31 days**.

### Example 9.3: edge cases

- **Spending before any income:** age 0.
- **Same-day income:** spending $40 on the day $40 arrives, with no older money left, is age 0.
- **Negative starting balance** (the account's first transaction is −$50 to Ready to Assign): not an outflow.
- **Off-budget activity:** ignored.

## 10. Loans (CLAUDE.md §5.10)

**Verification status: model, not verified.**
- YNAB says it calculates "the monthly interest charge", that interest (and escrow or fees) "must be covered first", and that the rest goes to principal ([Loan Accounts](https://support.ynab.com/en_us/loan-accounts-in-ynab-a-guide-HkNSkPHJi)).
- YNAB asks for the interest rate, "not the APR".
- **ASSUMPTION:** simple monthly accrual on the opening balance. YNAB doesn't say whether it accrues daily or monthly. Compare with a real lender statement in S6.4.

### Rules

1. **Monthly interest** = balance × rate ÷ 12, with the rate in basis points: `divRound(balance × bps, 120 000)`. That's integer math only, rounded half away from zero to the cent.
2. **Each month:**
   - Interest accrues on the opening balance.
   - The payment covers interest, then escrow, then fees, then principal.
   - The last payment is only what's owed (balance + charges).
3. **A payment that doesn't exceed interest + escrow + fees** never pays the loan off. It's rejected (`ValidationError`), as is anything over 1,200 months.
4. **Extra payments:** an extra amount every month and/or one-time amounts in specific months. All of it goes to principal.
5. **Payoff calculator:**
   - Enter a payment → get the payoff month, total interest and total paid.
   - Pick a payoff month → get the **smallest** monthly payment that pays off by then (binary search over whole cents; a bigger payment never pays off later).
6. **Loan Planner:** compares the plan with and without extra payments → interest saved and months saved.

### Example 10.1: monthly interest

| Balance | Rate | Exact | Charged |
|---|---|---|---|
| $100,000.00 | 6% | $500.00 | $500.00 |
| $123.45 | 5% | $0.514375 | $0.51 |
| $1.00 | 6% | $0.005 | $0.01 (half away from zero) |

### Example 10.2: amortization

$1,000 at 12% a year (1% a month), paying $300 a month:

| Month | Payment | Interest | Principal | Balance |
|---|---|---|---|---|
| Jan | 300.00 | 10.00 | 290.00 | 710.00 |
| Feb | 300.00 | 7.10 | 292.90 | 417.10 |
| Mar | 300.00 | 4.17 | 295.83 | 121.27 |
| Apr | 122.48 | 1.21 | 121.27 | 0.00 |

Paid off in April (4 months). Total interest $22.48; total paid $1,022.48.

- **With escrow and fees:** with $50 escrow and $5 fees, January's $300 covers $10 interest + $50 + $5 first, so principal falls by only $235 (to $765).
- **With an extra $100 a month:** interest is $10.00 + $6.10 + $2.16 = $18.26, and the loan is paid off in March. The Loan Planner reports **$4.22 interest saved, 1 month saved**.

### Example 10.3: payoff by a date

To pay the same $1,000 off by February (two payments):
- **$507.51 works.** It leaves $502.49, whose interest of $5.02 makes $507.51 due in February.
- **$507.50 is one cent short.** It leaves $502.50, and interest of $5.025 rounds to $5.03, so $507.53 is due.

So the required payment is **$507.51**. Paying it all in January takes $1,010.00 (principal plus a month of interest).

## 11. Reflect reports

Source articles: [Reflect](https://support.ynab.com/en_us/reflect-in-ynab-B1GJsrWkj), [Spending Breakdown](https://support.ynab.com/en_us/spending-breakdown-H1H7YxmD0), [Income v Expense](https://support.ynab.com/en_us/income-v-expense-Byu1BYWRq).

- **Filters:**
  - `from`/`to` months.
  - Accounts: default is every on-budget (cash and credit) account; for Net Worth, every account.
  - Categories: default is all; `uncategorized` selects uncategorized money.
- **Spending** means categorized activity in on-budget accounts. That has some consequences:
  - Transfers between on-budget accounts (including card payments) carry no category, so they never appear.
  - Inflows to Ready to Assign are income, not spending.
  - A categorized transfer to an off-budget account (a mortgage payment from checking) *is* spending.
- **ASSUMPTION:** refunds net against spending in their category. A category whose refunds exceed its spending over the range is listed in a separate **positive-inflow** section rather than reducing the total. YNAB shows such a section; whether its total nets them is unverified.

The example plan for §11.1–§11.4:
- Checking has a $1,000 starting balance on Dec 31.
- Income is $3,000 on Jan 1, $500 on Jan 15 and $3,000 on Feb 1.
- **Groceries:** −$200 (checking) − $100 (Visa) + $50 refund in January; −$300 in February.
- **Rent:** −$1,500 each month.
- **Housing:** a −$1,000 checking → mortgage payment on Jan 28.
- **Fun:** −$80 and +$100 (refund) in February.
- **Transfers:** $500 checking → savings, and a $100 card payment.
- **Off-budget:** a house worth $400,000 and a mortgage of −$300,000 from Jan 1.

### 11.1 Spending Breakdown (Jan–Feb)

| Group | Category | Spending |
|---|---|---|
| Needs ($4,550) | Rent | $3,000 |
| | Housing | $1,000 |
| | Groceries | $550 |

- **Positive-inflow section:** Fun +$20.
- **Total and average:** total $4,550; average $2,275 a month (rounded half away from zero).
- **Ranking:** groups and categories are stack-ranked, largest first.
- **Filters:** Visa only → $100. Groceries only → $550. February only → $1,800.

### 11.2 Spending Trends (Jan–Feb)

Spending is outflows net of refunds; it's negative when refunds win.

| Category | Jan | Feb | Total | Average |
|---|---|---|---|---|
| Groceries | 250 | 300 | 550 | 275 |
| Rent | 1,500 | 1,500 | 3,000 | 1,500 |
| Housing | 1,000 | 0 | 1,000 | 500 |
| Fun | 0 | −20 | −20 | −10 |
| **Total** | 2,750 | 1,780 | 4,530 | 2,265 |

### 11.3 Net Worth (month ends, every account)

| Month | Assets | Debts | Net worth | Change |
|---|---|---|---|---|
| Dec 2025 | 1,000 | 0 | 1,000 | +1,000 |
| Jan 2026 | 401,750 | −299,000 | 102,750 | +101,750 |
| Feb 2026 | 402,970 | −299,000 | 103,970 | +1,220 |

- **Assets** are the sum of positive account balances; **debts** are the sum of negative ones.
- **The first row's change** is measured against the month before the range.

### 11.4 Income v Expense (Jan–Feb)

- **Income** = inflows to Ready to Assign by payee, highest first:
  - Employer: 3,000 | 3,000 (total 6,000, average 3,000).
  - Side gig: 500 | 0.
  - Total: 3,500 | 3,000.
- **Expenses** = net categorized activity by group and category, negative = spending:
  - Needs: −2,750 | −1,800 (Groceries −250 | −300, Rent −1,500 | −1,500, Housing −1,000 | 0).
  - Wants: 0 | +20.
- **Net income:** 750 | 1,220 (total 1,970).
- **Exclusions (YNAB):** tracking-account activity and starting balances are left out, so net income doesn't match the change in net worth. A December-only report of checking + house shows $0 income: the Dec 31 starting balance is excluded, and the house is off-budget.

## 12. Golden tests against real YNAB data

### 12.1 Public export

**Data and how it's run:**
- **Data:** a public, real export (Plan.csv + Register.csv, exported 2026-09-14). It covers 58 months, 51 categories, 36 accounts (6 credit cards) and 7,571 transactions.
- **Where it lives:** locally in `packages/engine/test/fixtures/local/ynab-public-sample/`, git-ignored and **never committed** (personal data under a restrictive license). Without it, `golden.test.ts` is skipped.
- **Machine-local facts** go in `golden.json` next to the data:
  - the export date;
  - one account's change of type to credit card;
  - two transactions that were due but not yet entered;
  - the known differences, with reasons.

**Result (2026-10-08): 5,821 of 5,916 values (98.4%) match YNAB to the cent.**
- **Every regular category:** Activity and Available both match in every month (5,220 values).
- **Credit card payment categories:** 601 of 696 values match. The 95 that differ are documented, and the test fails if any *new* difference appears:
  - **The converted card.** One account became a credit card in 2023-08. From then on, YNAB's payment-category activity for it follows none of the documented card rules: payments, refunds and cash advances are counted inconsistently. This is probably legacy behavior for converted account types. Unexplained.
  - **Spillover onto other cards.** Differences on other cards occur only in months when the converted card also differs (shared overspent categories), plus the carry-over of those differences into Available.
  - **One isolated case.** In May 2023, YNAB funded $89.52 less of one card's spending although none of its categories ended the month overspent. Unexplained.

**Rules the golden data confirmed:**
- Negative balances reset (§1).
- Overspending is classified at month level, credit first (§3).
- Unfunded card spending is the most recent card spending first (§3.3).
- Rows dated after the export date are scheduled transactions and excluded.
- Refunds net against activity.
- Categorized transfers to off-budget accounts count as spending.

**What the export cannot verify:** Ready to Assign (not exported), targets (not exported), Age of Money, loans and reports.

**Other public data searched (2026-10-08).** A GitHub-wide code search for YNAB API exports turned up API schemas, mocks, and one real file: Actual Budget's MIT-licensed `ynab5-demo-budget.json`, a 2-month YNAB demo plan. It can't serve as an answer key:
- Every target amount in it is 0.
- Its transactions were edited after export without YNAB recomputing the months. September has a −$1,000 Ready to Assign transaction, but YNAB's `to_be_budgeted` is unchanged from August.

Only its August Ready to Assign ($10,000 in − $1,000 assigned = $9,000) is usable, and it matches §2. No other public source carries YNAB-computed Ready to Assign, target, Age of Money, loan or report values. The items in §13 can only be verified with a real YNAB plan.

### 12.2 Sarg's YNAB trial plan (2026-10-08)

**How it was run:**
- **Setup:** Sarg ran `docs/ynab-trial-scenario.md` in a YNAB trial. YNAB's numbers were read from the live plan in Chrome (screenshots) and from its export.
- **Test:** `goldenTrial.test.ts` holds every observed value. Local data is in `test/fixtures/local/ynab-trial/`.
- **Data entry:** one row was entered differently from the script (the $200 fuel purchase as an inflow). The engine was run on what was actually entered.
- **Fairness:** HAFB's predictions for the scripted plan were frozen before the trial (commit `7ace1fd`).

**Results:**

| Check | Before fixes | After (`bdd53dd`) |
|---|---|---|
| Plan.csv Activity and Available (all 17 categories) | ✅ exact | ✅ |
| Ready to Assign Oct/Nov ($3,070.00) and breakdown (Inflow +$5,500, Assigned −$2,430) | ✅ | ✅ |
| Month summaries (left over, assigned, activity, available) | ✅ | ✅ |
| 19 target cards (needed, funded, to go, assign, %) | ❌ 4 rules | ✅ |
| Cost to Be Me $1,390.01 | ❌ | ✅ |
| Upcoming bills (current month only) | ❌ | ✅ |
| Auto-Assign: Underfunded $285.01 / $1,395.00; Assigned/Spent last month, averages | ❌ | ✅ |
| Spending Breakdown $1,410.00 (net) and percentages | ❌ | ✅ |
| Income v Expense $4,500 / −$1,410; Net Worth (change $0 in month one) | ❌ | ✅ |
| Age of Money empty before 10 transactions (a split is one) | ❌ importer | ✅ |
| Mortgage payoff Oct 2056, 360 payments | ✅ | ✅ |
| Mortgage total interest | $0.50 off | $0.50 off (pinned) |

**Also confirmed:**
- **Credit card funding and payments** (Visa $10, Amex $40), including the most-recent-spending-unfunded-first rule.
- **Credit overspending:** it does **not** reduce next month's Ready to Assign ($3,070.00 in November), and the category resets to $0.
- **Export format:** split rows carry `Split (k/n)`, and starting balances use the payee `Starting Balance`.

## 13. Open questions and assumptions

Each item needs real YNAB behavior to confirm. The optional YNAB free-trial scenario (roadmap S1.7) is the planned way to check them.

| # | Topic | Status after the YNAB trial (2026-10-08) |
|---|---|---|
| Q1 | Ready to Assign breakdown fields (D11) | ✅ **Verified.** YNAB lists the non-zero lines (inflows this month, assigned this month, total); the engine provides every line |
| Q2 | Age of Money algorithm (D7) | ✅ **Verified on the trial:** empty before 10 transactions (a split counts once); with 10 outflows YNAB shows **4 days**, as predicted (first in, first out). In this data a simple mean and an amount-weighted mean both give 4, so which one YNAB uses is not yet distinguished |
| Q3 | Fresh Start starting balances (D12) | ✅ **Verified:** unlinked accounts restart at $0 (a $0 "Starting Balance" dated today); targets and scheduled transactions carry over |
| Q4 | Target formulas | ✅ **Verified** on 19 cards across 8 behaviors, plus the weekly creation-date rule: Groceries at $350 shows "Assign $50.00 more", as predicted (the "spending counts" alternative would have shown it met) |
| Q5 | Average Assigned/Spent window | ✅ **Verified:** months the plan has |
| Q6 | Underfunded with scheduled transactions | ✅ **Verified:** funded to the bill's total, current month only |
| Q7 | Loan interest accrual | ⚠️ **Near-match, being chased to the cent** (Sarg: estimators must be as accurate as possible). Payoff date and 360 payments are exact; total interest differs by $0.50 over 30 years, and no rounding method tried yet reproduces YNAB's cents (YNAB's own totals disagree by $0.01). Next: YNAB's first posted monthly interest after 2026-11-01 (roadmap Timed follow-ups) |
| Q8 | Converted-account card behavior (public export, 95 values) | ❓ Unexplained; optional trial extra |
| Q9 | Split rows in the export | ✅ **Verified:** `Split (k/n)` rows, recombined on import |
| Q10 | YNAB "Credit Card Interest" categorization | ⏳ Rolling out; not modeled |
| Q11 | Recurrence edge cases (twice a month, 31st) | ⏳ Documented only |
| Q12 | Reports | ✅ **Verified** for October: Spending Breakdown, Income v Expense, Net Worth |