# ADR 0001 — Desktop stack

- **Status:** Accepted (2026-10-08), after Phase 0 spike results on Sarg's machine (see §7).
- **Date:** 2026-10-08
- **Deciders:** Sarg (validation), Claude (spike build)

## 1. Context

HAFB is a free, local-only, native Windows envelope-budgeting app aiming for YNAB parity (CLAUDE.md §1). The stack has to meet these requirements:

- Never touch the network at runtime.
- Feel native on Windows 10 22H2+ / 11, including Snap Layouts and Win+Arrow.
- Render a 50k+ row register at 60 fps.
- Launch to a usable budget sheet in < 1.5 s.
- Keep all budget math in a pure, portable TypeScript engine (CLAUDE.md §2, §9).

CLAUDE.md §2 proposed Tauri 2 + React + TypeScript + SQLite "pending spike". On 2026-10-08, before scaffolding, the alternatives were re-surveyed for a Windows-only-for-now app (see §5). Sarg chose to build a **head-to-head WinUI 3 spike** next to the Tauri one. Tauri remains the expected outcome; the WinUI numbers are also data for any future rewrite.

## 2. Decision

| Layer | Choice | Version targeted |
|---|---|---|
| Shell | Tauri 2 (Rust core, WebView2) | `tauri` 2.12.1, `tauri-build` 2.7.1, `@tauri-apps/cli` / `@tauri-apps/api` 2.12.1 |
| UI | React + TypeScript (strict) | React 19.3.0, TypeScript **6.0.3** |
| Bundler / tests | Vite + Vitest | Vite **8.3.2**, `@vitejs/plugin-react` 6.1.2, Vitest 5.0.3 |
| Grid | TanStack Table + TanStack Virtual | `@tanstack/react-table` **9.2.6**, `@tanstack/react-virtual` 3.14.13 |
| Storage | `rusqlite` behind Tauri commands, WAL | `rusqlite` 0.40.2 (`bundled`, SQLite compiled in) |
| Title bar | HTML title bar + `tauri-plugin-frame` native snap overlay | `tauri-plugin-frame` **=1.1.8** (exact pin) |
| Lint | ESLint flat config + typescript-eslint (strict, type-checked) + react-hooks, `tsc`, `cargo clippy -D warnings` | ESLint 10.12.0, typescript-eslint 8.71.1, eslint-plugin-react-hooks 7.1.1 |
| Package manager | pnpm workspaces | pnpm 12.10.1 |
| Toolchain | Rust stable MSVC, Node 22 | rustc 1.98.1, Node 22.17.0 |
| Packaging | Tauri bundler → `.msi` (WiX); portable = raw release `hafb.exe` | — |

### Choices made inside the spike, and why

- **TypeScript 6.0.3, not 7.0.** TypeScript 7 (the native Go port) is `latest` on npm, but typescript-eslint 8.71 supports `typescript >=4.8.4 <6.1.0`. Using TS 7 would break the type-checked lint that `pnpm lint` requires. Revisit when typescript-eslint supports TS 7.
- **Vite 8.3.2, not 8.3.4.** 8.3.4 was published the same day and failed pnpm 12's `minimumReleaseAge` supply-chain gate. We pinned an older patch rather than adding an exclusion. Keep that gate on.
- **`rusqlite` over `tauri-plugin-sql`:**
  - It keeps Rust as thin, typed commands that return plain JSON (CLAUDE.md §9).
  - The webview never gets a raw "execute any SQL" capability.
  - `bundled` pins a known SQLite version.
  - `tauri-plugin-sql` would put SQL strings in the UI layer and pull in sqlx.
- **Title bar: `tauri-plugin-frame` 1.1.8.**
  - **The problem:** Windows only shows the Snap Layouts flyout to a window whose `WM_NCHITTEST` returns `HTMAXBUTTON`. In Tauri, the WebView2 child window covers the client area and answers hit-tests first, so no HTML/CSS can produce it.
  - **How the plugin fixes it:** it places an invisible native child window over the HTML maximize button. That window returns `HTMAXBUTTON` and forwards hover and click back to the page as events.
  - **Source audited 2026-10-08:**
    - Its dependencies are `tauri`, `serde`, `serde_json`, `eyre`, `raw-window-handle` and `windows-sys`.
    - No HTTP, file, or process APIs. The injected JS makes no `fetch` calls and loads nothing external.
    - Its Win32 code is about 380 lines.
    - Its only panics are `expect` calls on a poisoned mutex.
  - **Constraints it imposes:**
    - It requires `app.withGlobalTauri = true`, which is acceptable because only our own bundled content ever loads.
    - It injects its own caption buttons into `[data-tauri-frame-tb]`. That element is static in `index.html` so it exists before the plugin's script runs.
    - The title bar must be exactly 32 px and the caption buttons 46 px, matched in `lib.rs` and `app.css`. If they drift, the flyout silently stops appearing.
    - The window minimum width is kept at 480 px, since minimums above about 500 px stop snapping.
  - **Fallback:** the native Windows title bar, which CLAUDE.md §6.14 allows. The spike can switch to it at runtime.
- **WebView2 install mode: `skip`.** The installer never downloads anything (CLAUDE.md §1). WebView2 Evergreen ships with Windows 11 and is installed on supported Windows 10 22H2. The trade-off: a machine without WebView2 gets a non-starting app instead of an auto-install. Revisit if that shows up in practice.
- **No router library.** The `/spike` screens use a hash route (`#/spike`) with `useSyncExternalStore`, so there's one dependency fewer.
- **Production CSP blocks the network from the webview:** `default-src 'self'; connect-src ipc: http://ipc.localhost`. In dev the CSP is off so Vite HMR works.
- **Lint guardrails encoding CLAUDE.md rules:**
  - No `as` casts outside tests.
  - In `packages/engine` and `packages/shared`: no imports of React, Tauri, `apps/` or Node I/O, and no `Date.now`, `Math.random` or `new Date`.
  - The engine's tsconfig has no DOM lib.

## 3. Dependencies added, and runtime network behavior

**Runtime (shipped):**

| Dependency | Why | Network at runtime? |
|---|---|---|
| `react`, `react-dom` | UI | None. |
| `@tanstack/react-table` (+ `table-core`, `@tanstack/react-store`, `@tanstack/store`) | Grid model (§2 decided) | None. Headless, pure JS. |
| `@tanstack/react-virtual` (+ `virtual-core`) | Row virtualization | None. Pure JS. |
| `@tauri-apps/api` | JS↔Rust IPC | Local IPC only (`ipc://`), no sockets. |
| `tauri` (default features) | Shell | None. The updater, HTTP and shell plugins are not included. Confirm with `cargo tree -e normal \| findstr /i "reqwest hyper ureq rustls native-tls"` (empty = good). |
| `serde` | Command payloads | None. |
| `rusqlite` (`bundled`) | SQLite | None. Local file only. |
| `tauri-plugin-frame` =1.1.8 | Snap Layouts with a custom title bar | None (audited; see §2). |
| `windows-sys` 0.61 | Process start time for the launch spike | None. Raw Win32 bindings; already a transitive dependency. |

**Dev-only:** `@tauri-apps/cli`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `@types/react`, `@types/react-dom`. None of these ship.

**Network at build time only** (allowed; not the app):
- `pnpm install` and cargo crate fetches.
- The Tauri CLI downloads the WiX toolset on the first `.msi` build.
- `dotnet publish` restores NuGet packages for the WinUI spike. `DOTNET_CLI_TELEMETRY_OPTOUT=1` is set by `scripts/build-winui-spike.mjs`.

**WebView2 itself:** Tauri's default WebView2 arguments disable SmartScreen (`msSmartScreenProtection`). We do not override them. The real-machine check in §7 verifies no outbound connections.

- **Corrected by S8.3 (2026-10-10):** that check (a short run) missed WebView2's own traffic.
  - **What WebView2 does out of the box:** it fetches Microsoft's experiment configuration (`config.edge.skype.com`) at start and component updates (`edge.microsoft.com`) about a minute in.
  - **What HAFB does now:** it creates the WebView2 environment itself (`src-tauri/src/webview_env.rs`, using `webview2-com` and `windows-core`, both already in the tree, pinned to Tauri's versions):
    - Tauri's arguments, plus a proxy on a closed loopback port, so those fetches fail on the PC.
    - `IsCustomCrashReportingEnabled` on.
    - Single sign-on off.
  - **What remains:** one lookup per launch of the Windows Microsoft account's profile by WebView2's OneAuth library. No supported switch stops it, and Sarg chose to document it.
  - Details and evidence: `docs/privacy.md`.

## 4. The spike

Everything below is throwaway, to be deleted when Phase 0 closes.

- **Tauri:** `apps/desktop/src/spike/*` and `apps/desktop/src-tauri/src/spike/*`. The screens live behind `#/spike`.
  - **(a) SQLite:** opens `spike.sqlite` in `%LOCALAPPDATA%\app.hafb.desktop\` with WAL, writes 50,000 rows in one transaction, and reads them all back over IPC. It then checks that the integer sum is identical in Rust, SQL and JS.
  - **(b) Grid:** 50,000 synthetic rows at 30 px, built with TanStack Table 9 + Virtual. It has three frame-timing benchmarks: steady 3000 px/s for 10 s, top-to-bottom fling in 5 s, and 10 s of manual scrolling. Each reports median/p95/p99/max frame time and missed vsyncs against an idle-measured refresh interval.
  - **(c) Title bar:** custom vs native, switchable (the app restarts), with a checklist.
  - **(d) Launch:** time from OS process creation (`GetProcessTimes`) to the first painted React frame. `pnpm build` prints the `.msi` and portable exe sizes.
- **WinUI 3 comparison (removed 2026-10-08, never measured):** was `spikes/winui3/`, built with `pnpm spike:winui`.
  - Windows App SDK **2.5.1 stable**, .NET 10, Native AOT, unpackaged, self-contained.
  - The same 50,000 rows (same PRNG), 30 px rows in a `ListView` with a column template, the same three benchmarks and report format, and the same process-creation → first-frame timing.
  - The title bar uses `ExtendsContentIntoTitleBar`, so Windows draws the caption buttons and Snap Layouts are native.
  - **Caveat:** WinUI's own grid control (`TableView`) exists only in Windows App SDK 2.5 *Experimental* (2026-09-29), not in stable. A ListView with a template is what could ship today.
  - **Measurement caveat:** WinUI scrolls on the compositor thread, so its frame numbers measure the UI thread realizing rows. Watch for blank or placeholder rows while scrolling; they won't show up in the numbers.
  - **Build friction met on 2026-10-08.** It's recorded here because it's real evidence about the WinUI path; each fix is in `spikes/winui3/HafbWinUiSpike.csproj` and `scripts/build-winui-spike.mjs`:
    1. **AOT link failed** on this machine's VS 18. Its `vcvarsall.bat` writes a stray "cannot find the path" to stderr, which ILCompiler's linker lookup captures. Fix: the build script loads the MSVC environment itself and passes `IlcUseEnvironmentalTools=true`.
    2. **Oversized output.** The `Microsoft.WindowsAppSDK` metapackage ships about 60 MB of AI/ML/Search runtimes (ONNX Runtime, DirectML). Fix: reference only `Microsoft.WindowsAppSDK.WinUI`. The publish folder went from 138 MB to about 62 MB, excluding `.pdb`.
    3. **Startup crash: missing resources.** The app's `.pri`/`.xbf` resources weren't copied into the unpackaged publish output. Fix: `EnableMsixTooling=true`.
    4. **Startup crash: AOT interop** (`0xC000027B`, E_INVALIDARG on `ListView.ItemsSource`). CsWinRT silently skipped generating AOT interop for `List<SpikeRow>` (warning CsWinRT1030). Fix: `AllowUnsafeBlocks=true`.
  - Fixes 3 and 4 were silent until runtime: no build error, just a crash. A `crash.log` handler in `App.xaml.cs` now records the real exception next to the exe.

**Pre-handoff smoke test (2026-10-08, by Claude, on this machine):**
- Both release builds launched and rendered: the Tauri portable exe showed its home screen with the custom title bar, and the WinUI exe showed its 50k-row list.
- `pnpm dev`, `pnpm test`, `pnpm lint` and `pnpm build` all ran clean.
- `cargo tree` shows no HTTP or TLS client crates.
- No timing was recorded as a result: single runs on a machine busy compiling are not measurements. §7 is Sarg's.

## 5. Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| **Tauri 2 + React/TS** | **Chosen** (validated, §7) | TS engine shared with the UI and any future web/mobile port; mature virtualized grid; Sarg's primary stack; small binary. Cost: Snap Layouts need a native overlay; WebView2 memory is higher than native. |
| **WinUI 3 / Windows App SDK (C#)** | Rejected (spike dropped, see §4/§7) | Truest Fluent look, lower memory, built-in screen-reader support, Native AOT, Snap Layouts for free. But there's no stable data grid (TableView is experimental-only as of 2026-10), the engine would have to be C# (losing the TS engine's portability), and it isn't Sarg's primary stack. Reconsider if Tauri misses §7's bar or once TableView ships stable. |
| **Electron** | Rejected (§2) | 150 MB+ install, bundled Chromium. Only if WebView2 proves incapable. |
| **WPF (.NET 10)** | Rejected | Mature DataGrid, but Microsoft lists its Fluent theme as "still in progress", it has no Native AOT, and it is the older stack with no advantage over WinUI here. |
| **React Native for Windows** | Rejected | Keeps TS with native rendering, but has no data grid, its New Architecture isn't at full parity, and it requires VS 2026. |
| **Microsoft.UI.Reactor** (React-style C# on WinUI) | Watch | 0.1.0 public preview; too early. |
| **Avalonia 12** | Rejected | Not a Windows-native look, and its TreeDataGrid needs a paid Accelerate license since 11.2. |
| **Flutter** | Rejected (§2) | Dart isn't in the stack; desktop text-input rough edges. |
| **Hosted web app** (YNAB's current model) | Rejected | Needs a server and keeps data in evictable browser storage, which violates §1 (local-only, a single file the user owns). The Tauri UI *is* web tech, so a browser/PWA build stays possible later via a different storage layer. |

## 6. Consequences

- The UI is web technology inside WebView2, so look and feel are our responsibility. We use Segoe UI Variable, Fluent-like spacing, the 34/30 px row heights, and dark mode via `prefers-color-scheme`.
- The custom title bar depends on a single-maintainer community plugin. If it breaks with a Tauri update, we can vendor about 380 lines of Win32 or switch to the native title bar.
- Accessibility depends on correct ARIA on the grid (WebView2 maps ARIA to UI Automation). We'll test with Narrator in Phase 3.
- If §7 fails, or is marginal on grid frame timing or launch time, the fallback is WinUI 3 + .NET with the engine in C# (or a WebView2 island only for the grid). That would be ADR 0002.

## 7. Spike results

Run by Sarg on his machine, 2026-10-08. Display: 1920×1032 CSS px at 100% scale, 60 Hz.

### Tauri (`pnpm build` → `HAFB-portable.exe`)

| Check | Result |
|---|---|
| (a) SQLite: PASS lines (WAL, integrity) | **PASS / PASS.** SQLite 3.53.2, `journal_mode=wal`; the integer sum −575000 was identical in Rust, SQL and JS across 50,000 rows. |
| (a) write 50k: rust ms / round-trip ms | 43.3 / 45.2 |
| (a) read 50k: rust ms / round-trip ms | 14.6 / 68.6 (IPC + JSON ≈ 54.0) |
| (a) open: rust ms / round-trip ms | 37.7 / 39.7 |
| (b) steady 3000 px/s, 10 s | median 16.7 · p95 17.0 · p99 17.1 · max 17.1 ms · **0 missed (0.0%)** · 0 hitches |
| (b) fling 50k, 5 s | median 16.7 · p95 16.9 · p99 16.9 · max 17.0 ms · **0 missed (0.0%)** · 0 hitches |
| (b) manual wheel/scrollbar, 10 s | median 16.7 · p95 17.0 · p99 17.1 · max 17.1 ms · **0 missed (0.0%)** · 0 hitches |
| (c) custom title bar: snap flyout / Win+Z / Win+Arrows / drag-to-top / double-click / resize | All pass |
| (c) native title bar: same checks | All pass |
| (d) launch, process → first paint | ≈ 500 ms (target < 1.5 s) |
| (d) `.msi` / portable exe size | 2.25 MB / 4.20 MB |
| Memory (idle, grid tab) | **≈ 130 MB total**: `hafb.exe` host ≈ 6 MB plus the WebView2 group 123.5 MB (renderer 32.3, GPU 52.2, manager 28.3, network service 6.1, storage 2.7, Crashpad 1.8). This is expected WebView2 overhead and the known cost versus native (§5). |
| Network: no TCP connections; works offline | Confirmed |

### WinUI 3

Not measured. Sarg dropped the comparison on 2026-10-08 ("it took a lot of tries just to get it to work") and the spike was deleted. §4 keeps the build-friction findings as the only WinUI evidence gathered. Those findings are themselves a data point against WinUI for this project: four separate fixes were needed, two of them silent until runtime.

### Verdict

- [x] **Tauri meets the bar:**
  - Grid p95 was 17.0 ms, well within the 25 ms limit (1.5× the 16.7 ms refresh interval), with 0% missed frames on all three runs.
  - Launch was about 500 ms, under the 1.5 s target.
  - Every snap check passed in both title bar modes.
  - No network activity.
- **Status → Accepted** (2026-10-08). The custom title bar (`tauri-plugin-frame`) is the default; the native title bar remains a tested fallback.

**Caveats carried forward:**
- **Crash reporting (resolved in S8.3, 2026-10-10):** WebView2 runs a Chromium **Crashpad** process, but it has no upload address and only writes dumps into the profile's `Crashpad` folder. Whether Windows then sends them to Microsoft follows the OS diagnostic-data consent, unless the app sets `IsCustomCrashReportingEnabled`; with it set, "Windows won't send crash data to Microsoft endpoint" (Microsoft's WebView2 API reference). HAFB sets it (`webview_env.rs`). A crash of `hafb.exe` itself is Windows Error Reporting's business, under the user's Windows settings, as for any program. See `docs/privacy.md`.
- The register grid ran on a 60 Hz display only. Re-run the grid spike on a high-refresh display when one is available.
- The perf budget's 20k-transaction, 2019-era-laptop launch target (CLAUDE.md §8) is not covered by this spike. Re-measure when the real budget loads in Phase 3.
