# ADR 0005 — Smoke tests drive the real app over WebView2's DevTools port

- **Status:** Accepted (2026-10-08), S3.5.
- **Context:** CLAUDE.md §2 planned "Playwright (via Tauri's WebDriver support)" for a small smoke suite. On Windows that route needs `tauri-driver` (a cargo-installed binary) plus an `msedgedriver` matching the installed WebView2 version, which updates itself. That's fragile on a dev box, and it adds a network download to the test setup.

## Decision

- **Connection:** the suite launches the **release** `hafb.exe` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`. It connects with **`playwright-core`** (`chromium.connectOverCDP`). This was verified on Sarg's machine: WebView2 exposes the page at that port.
- **Dependency:** `playwright-core` 1.63.0 is a dev dependency of `apps/desktop`, pinned exactly.
  - It has no dependencies, downloads no browsers (we never run `playwright install`), and sends no telemetry.
  - The shipped app is unaffected: the port only opens when the test harness sets that variable.
- **Isolation:** each run gets its own app data folder (`HAFB_DATA_DIR`, read by the Rust app) and WebView2 profile (`WEBVIEW2_USER_DATA_FOLDER`). It opens a fresh fixture plan, the sample household written by the real `hafb-store` CLI, via `hafb.exe --open <path>`.
- **Runner:** `node:test`, run by `pnpm smoke` (expects a release build) or `pnpm smoke:build` (builds first). It isn't part of `pnpm test`: it needs a built app and a desktop session.

## Consequences

- The suite exercises the real IPC, SQLite store and WebView2, not a browser stand-in.
- **Not covered:** native file dialogs and Windows chrome (title-bar caption buttons, Snap Layouts) are outside the webview, so Playwright can't reach them. Those stay manual or UI-Automation checks (`scratchpad` scripts during development, documented in the roadmap's validation steps).
- **Release check:** the debugging port must never be opened by the app itself. A Phase 8 privacy check confirms the release binary contains no `remote-debugging` flag.
