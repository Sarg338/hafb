# Surface: HAFB app screens (S3.1 mockups → Phase 3/4 build)

Scope: the whole desktop app: shell, Plan, Inspector, Register, Reflect. Visitor mode: **Operate**.
Audience/job: YNAB users at a Windows PC, a few sessions a week: assign money, enter and approve transactions, check what's safe to spend, review reports.
Constraints: YNAB's structure and vocabulary; Fluent-native shell (custom title bar, Snap Layouts, Segoe UI Variable); 34 px plan rows, 30 px register rows; light, dark and high contrast; status readable without colour; themeable (every colour through semantic tokens; a theme is data).
Quality bar: YNAB (web), Monarch, Copilot Money.
Unresolved: logo/app mark; final accent hue may be revisited when Sarg reviews the mockups.

## Direction contract

THESIS: The budgeting screen YNAB users already trust, rebuilt as a first-class Windows app: calm neutral surfaces, money in clean tabular columns, and colour reserved for the state of each dollar (funded, underfunded, overspent, snoozed). It refuses the fintech-dashboard default of cards, gradients and hero metrics.

OWN-WORLD: Fluent light/dark neutrals (soft grey app ground, white work surface, Mica-tinted sidebar); one HAFB accent (a deep teal-green "money" hue, not YNAB's purple/green branding) for selection, primary actions and the Ready to Assign banner; Available pills in green / amber / red / grey with outline-and-icon variants; 4 px radii, hairline dividers, Segoe UI Variable with tabular numerals, Fluent System Icons at 16/20 px.

STORY: Open the plan → see at a glance what's ready to assign and which categories need attention → assign or cover with the keyboard → the inspector explains the selected month or category → registers and reports use the same grammar.

FIRST VIEWPORT: Title bar; left sidebar (plan menu, Plan / Reflect / All Accounts, account groups with balances); main: month header with Ready to Assign banner top-centre and its Assign button, Focused View chips, then the dense category grid (Category, Assigned, Activity, Available) with segmented progress bars under names; right: Inspector with month summary, Auto-Assign, Cost to Be Me. Primary action: the Assign button in the banner.

FORM: Category standard (canon), chosen by Sarg over the roll's Till Roll and the pick Columnar Ledger; seed d24513fb. Signature interaction: assigning animates the Ready to Assign figure and the category's pill and bar together (one 180 ms ease-out), so cause and effect are visible.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
