# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(The UI is a web UI rendered by WebView2 inside a native Windows window via Tauri 2. The design language is Windows desktop, Fluent-aligned, not a website. See CLAUDE.md §1–§2 and ADR 0001.)

## Users

- **First:** Sarg, the developer, who is replacing YNAB with a free, local tool and using it daily.
- **Then the public:** people leaving YNAB (confirmed 2026-10-08). They already know envelope budgeting and YNAB's vocabulary, and they arrive with years of history in a YNAB export.
- **Their situation:** a Windows PC, usually a laptop. They sit down a few times a week to enter or approve transactions, assign money, and look at where it went.
- **The job:** give every dollar a job and see what's safe to spend, without a subscription or an account.

## Product Purpose

HAFB is a free, local-only envelope-budgeting app for Windows with full feature parity with YNAB (web/desktop, 2026), minus anything that needs YNAB's servers.

Success means a YNAB user imports their export, sees their plan reproduced to the cent, and switches for good.

## Positioning

- **Free.** No subscription, no paywall, no "pro" tier.
- **Local-only.** It never touches the network: no account, no telemetry, no update checks.
- **One file.** The plan is a single SQLite file the user owns and can inspect.
- **Faithful.** It reproduces YNAB's budget math exactly, verified against real YNAB data, so switching costs nothing.

## Operating Context

- A native Windows window with a custom title bar and Snap Layouts.
- Keyboard-first use of dense, tabular screens:
  - **Plan:** categories with Assigned, Activity and Available.
  - **Register:** account transactions.
  - **Inspector:** the right-hand detail panel.
  - **Reflect:** reports.
- The data is a `.hafb` file, which may live in a OneDrive or Syncthing folder.
- Onboarding is mostly importing a YNAB export zip.

## Capabilities and Constraints

- The full scope is in CLAUDE.md §4–§6 and `docs/ynab-parity.md`.
- **UI vocabulary** is YNAB's: Plan, Ready to Assign, Assigned, Activity, Available, Targets, Reflect, Inspector.
- **Layout and data presentation mirror YNAB's structure:** sidebar, plan columns, available pills, progress bars, inspector and register layout. HAFB keeps its own visual identity and never copies YNAB's branding or artwork.
- **Density:** plan rows about 34 px, register rows about 30 px, tabular numerals wherever money appears.
- **Performance:** a 50k-row register scrolls at 60 fps, and the app is usable less than 1.5 s after launch.
- **Out of scope:** bank sync, cloud sync, shared plans, mobile apps.

## Brand Commitments

- **Name on screen:** "HAFB". "Here's A Free Budget" appears only in About and the installer.
- **Voice:** warm and encouraging, like YNAB (confirmed 2026-10-08). The app coaches and celebrates (for example, paying off a loan), but errors stay clear and factual.
- **License and price:** MIT, free.
- **No logo yet.** Never borrow YNAB's name, logo or artwork in the product.
- **Visual direction (2026-10-08): the category standard, played straight.**
  - Sarg chose the familiar look over the novel directions on offer (Till Roll, Columnar Ledger, Departure Board, One Accent).
  - It means YNAB's friendly plan screen (green, yellow and red Available pills, a Ready to Assign banner, segmented progress bars) in Windows-native Fluent grammar: Segoe UI Variable, custom title bar with Snap Layouts.
  - The craft bar is **YNAB (web), Monarch and Copilot Money**. Match their finish; don't copy their branding.
- **Themes (2026-10-08):** the design must support user-selectable themes later.
  - Light, dark and high contrast ship first.
  - Every colour goes through semantic theme tokens, so a new theme is data, not code.

## Evidence on Hand

- Real YNAB exports (local only, not committed):
  - Sarg's trial plan.
  - A public sample with about 7.5k transactions, used for golden tests and realistic mockup data.
- YNAB UI reference screenshots, for layout study only: `docs/ui-references/ynab/`. They are copyrighted and not committed.
- No testimonials, users or press exist. Don't fabricate any.

## Product Principles

1. **The numbers are sacred.** Exact, integer, YNAB-identical math. The UI never computes or rounds money on its own.
2. **Familiar to YNAB users.** Same structure and words, so muscle memory transfers.
3. **Yours, offline, forever.** No accounts, no network (bank sync is opt-in), one file, automatic backups.
4. **Fast and keyboard-first.** Dense screens that respect daily use.
5. **Encouraging, never anxious.** Money is stressful; the app helps the user feel in control.

## Accessibility & Inclusion

- WCAG 2.2 AA.
- Light, dark and high-contrast themes, with every status distinguishable without color.
- Screen-reader labels on the grids; full keyboard operation.
- Correct at 100–200% display scaling (CLAUDE.md §6.15, roadmap S3.1 and S7.4).
