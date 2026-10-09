# ADR 0008 — Charts are hand-drawn SVG; exports are built in the webview and saved by Rust

- **Status:** Accepted (2026-10-09), S6.1.
- **Context:** Reflect needs a donut, stacked bars with an average line, bars with a net worth line, and an Age of Money line. It also needs CSV/TSV exports, PNG images of the charts, and the Share Your Progress image. Every library must pass the no-network audit (CLAUDE.md §1, §10), and every colour must come from a theme token, including the no-colour patterns.

## Decision

- **No charting library.** Charts are plain SVG drawn by React from engine numbers. The geometry helpers (`screens/reflect/charts/scale.ts`: nice ticks, linear scales, donut arcs) are about 50 lines; `Patterns.tsx` holds the eight series fills and their no-colour patterns.
  - **Rejected:** Recharts, visx, Chart.js and ECharts. They bring hundreds of KB, their own colour and animation systems that fight the token rules (`sourceScan.test.ts`), and an audit burden, all for four simple chart types.
- **PNG images:** `chartImage.ts` clones the on-screen SVG, writes each element's computed style inline (theme tokens and patterns survive), and draws it on a canvas at 2× or more for high-DPI screens. Share Your Progress composes its own SVG (format, tagline, amounts on or off) and renders it at the format's pixel size (1080×1350, 1080×1920, 1920×1080, 1080×1080).
- **Files:**
  - The webview builds the bytes: CSV/TSV text (`@hafb/store` `export/csv.ts`, `export/register.ts`), a stored zip (`export/zipWrite.ts`) or a PNG.
  - Rust's `save_export` (`src-tauri/src/exports.rs`) shows the native Save dialog and writes the raw request body there. The suggested name travels percent-encoded in a header, and only `.csv`, `.tsv`, `.zip` and `.png` are accepted.
  - The smoke suite sets `HAFB_EXPORT_DIR` to skip the dialog.
- **Formats follow YNAB's exports**, observed in the trial (2026-10-09):
  - Encoding: UTF-8 with a BOM, CRLF between rows, text quoted and numbers bare. Currencies that use a decimal comma get TSV.
  - Spending reports: a zip holding the summary and its transactions.
  - Net Worth: one row per account, then a Net Worth row.
  - Income v Expense: YNAB's row order.

## Consequences

- No new dependency and no network surface; charts restyle with the theme like everything else.
- Hover, drill-down and keyboard behaviour are ours to build and test (DrillDown, the month tables, the `role="img"` labels and hidden tables for screen readers).
- With Reflect rebuilt, the S3.1 stylesheet (`design.css`) no longer loads in the app. The mockups (`#/design`) and the gallery are loaded on demand, so their CSS stays out of the app bundle (ADR 0007's last open item).
