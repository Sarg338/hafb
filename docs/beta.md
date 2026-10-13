# HAFB beta: a guide for testers

Thank you for trying HAFB before its 1.0 release. HAFB is a free, local-only envelope budget for Windows that works like YNAB. This beta is for people who use YNAB today, or used it recently: you know what YNAB does, so you'll notice when HAFB does something different.

- **Version:** 0.9.0 (beta). Betas are numbered 0.9.x; the first stable release will be 1.0.0.
- **Runs on:** Windows 10 22H2 or later, or Windows 11, on an x64 PC.
- **Costs:** nothing, now or later. There is no account to make and nothing to sign in to.

## What you get

| File | What it is |
|---|---|
| `HAFB_0.9.0_x64_en-US.msi` | The installer. Needs an administrator once. |
| `HAFB_0.9.0_x64_portable.zip` | The portable version: unzip and run, no install. Keeps its data in its own folder. |
| `SHA256SUMS_0.9.0_x64.txt` | Checksums, to confirm the files arrived intact. |

[install.md](install.md) explains both, including the **Windows protected your PC** warning you'll see because the beta isn't code-signed, and how to check a download's checksum.

## Before you start

- **Keep using YNAB.** Run HAFB alongside it during the beta; don't cancel anything because of HAFB yet.
- **Your data stays on your PC.** HAFB never connects to the internet ([privacy.md](privacy.md)). Nothing you do in the beta reaches the developer unless you send it.
- **Backups happen by themselves** every time you open a plan, but keep your YNAB export zip too.

## What to try

Pick whatever matches how you use YNAB. Each item has the guide section that explains it.

1. **Bring your plan across** ([migrating-from-ynab.md](migrating-from-ynab.md)). Export from YNAB, import into HAFB, check the account types, then compare Ready to Assign, your categories' Available amounts and your account balances with YNAB for this month. *They should match to the cent; if one doesn't, that's the most useful thing you can report.*
2. **A week of normal use.** Enter or import your transactions in HAFB as well as YNAB, assign money, move money, cover overspending. Compare at the end of the week.
3. **Credit cards.** Spend on a card, pay it, overspend on it once on purpose, and check the payment category against YNAB.
4. **Targets.** Re-enter a few targets (**Add targets…** after the import, or **Create Target** on a category) and compare what YNAB and HAFB say you need this month.
5. **Bank files.** Download a CSV, OFX, QFX or QIF from your bank and use **File Import**. Then import the same file again: nothing should come in twice.
6. **Reconcile** an account against a statement.
7. **Reflect.** Look at your reports and compare a month with YNAB's.
8. **Anything else you do in YNAB every month.** If HAFB can't do it, or does it differently, tell us.

[user-guide.md](user-guide.md) covers everything; in the app, **Help…** in the plan menu has the short version and `?` lists the shortcuts.

## How to report something

Reply to the message your beta invitation came in. One report per problem is easiest to track. This template covers what's needed:

```
What happened:
What you expected (or what YNAB does):
Steps to make it happen again:
How often: always / sometimes / once
HAFB version (Help → About HAFB):
Windows version (Settings → System → About):
Installer or portable:
Screenshot: (optional; hide amounts first with the eye button if you like)
```

**Please don't send** your plan file, your YNAB export or bank files, which hold your financial history. Never send a plan password. If a problem only shows with your data, say so and we'll work out a way to reproduce it with made-up numbers.

**Ideas and "YNAB does it differently"** are welcome too. HAFB aims to match YNAB's web app, so a difference is a bug unless it's on the list below.

## Known limits of this beta

- **Not code-signed.** Windows warns on first run ([install.md](install.md)).
- **Bank sync is new.** Optional sync through SimpleFIN Bridge (**Preferences…** → Bank sync) has been tested against SimpleFIN's demo bank, not yet a real one. If you try it, tell us your bank and what came in. Bank files still work as before. YNAB's own bank connections (Plaid, MX) will never be in HAFB.
- **Not built:** YNAB Together (shared plans), mobile apps and cloud sync. They need servers HAFB doesn't have. Your plan is a file you can keep in OneDrive or Syncthing.
- **Early or unconfirmed against YNAB:**
  - *Credit Card Interest* (off by default in **Preferences…**). YNAB is still rolling it out, so HAFB's version follows YNAB's announcement.
  - The date and amount of a loan's monthly interest. HAFB posts it on the 1st; YNAB's first posting hasn't been checked yet.
- **Windows on ARM:** an ARM64 build exists but hasn't been run on ARM hardware. The x64 build runs under Windows' emulation.

## Feedback triage

Every report gets an entry in the triage log below, usually within a few days, with one of these outcomes:

| Outcome | Meaning |
|---|---|
| **Blocker** | Wrong numbers, lost or damaged data, or a crash. Fixed before anything else, with a test that would have caught it, and a new 0.9.x build. |
| **Bug** | Something broken or different from YNAB. Fixed in the next build. |
| **Parity** | YNAB does something HAFB doesn't. Added to `docs/ynab-parity.md` and planned. |
| **Idea** | Not in YNAB. Considered after 1.0. |
| **Can't reproduce** | Needs more detail; we'll ask. |
| **Won't fix** | Out of scope (needs a server, or YNAB doesn't do it either), with the reason. |

The beta ends, and 1.0 follows, when every blocker and bug is fixed or explained, testers' numbers match YNAB, and the parity checklist has nothing open except optional bank sync.

### Triage log

| # | Date | Report (one line) | Outcome | Fixed in / notes |
|---|---|---|---|---|
| 1 | 2026-10-12 | Setting up a plan from a bills spreadsheet: pressing Enter in a money field saved the amount from before the typing (a target's amount, a card target's amount, expected income). | Blocker | Fixed in 0.9.0: Enter saves what was typed. Smoke test "Enter in a money field saves what was just typed". |
| 2 | 2026-10-12 | The installer spent 80 seconds making a System Restore point. | Bug | Fixed in 0.9.0: no restore point (`MSIFASTINSTALL`, ADR 0011). |
| 3 | 2026-10-12 | A loan's page read "Paired with Mortgage : payments…", with stray spaces. | Bug | Fixed in 0.9.0. |
| 4 | 2026-10-12 | After quitting, HAFB starts on the welcome screen, not the plan you had open. YNAB goes straight to your last plan. | Parity | Fixed in 0.9.0: HAFB reopens the plan open at the last quit; Close plan before quitting starts at the welcome screen. |
| 5 | 2026-10-12 | Each bill is entered three times: its category, its target and its scheduled payment. YNAB is the same. | Idea | After 1.0. |
