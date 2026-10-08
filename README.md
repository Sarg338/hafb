# HAFB — Here's A Free Budget

A free, local-only, native Windows envelope-budgeting app. It aims for feature parity with YNAB without accounts, servers or subscriptions. Your budget is one SQLite file that you own. MIT licensed.

**Status: Phase 1 (budget engine) complete; Phase 2 (persistence) next.** The engine is tested but there is no budget UI yet. See `docs/budget-math.md` for every rule with worked examples. See [CLAUDE.md](CLAUDE.md) for the spec and [docs/decisions/0001-stack.md](docs/decisions/0001-stack.md) for the stack decision.

## Requirements

- Windows 10 22H2+ or Windows 11 (x64) with the WebView2 Evergreen runtime. It's preinstalled on Windows 11.
- Node.js ≥ 22.12 and pnpm 12 (`npm install -g pnpm@12.10.1`).
- Rust stable (MSVC) with clippy (`rustup component add clippy`), plus Visual Studio Build Tools with the C++ workload.

## Commands

```
pnpm install
pnpm dev            # run the app with hot reload (Tauri + Vite)
pnpm test           # Vitest, all packages
pnpm test:engine    # engine only
pnpm lint           # tsc (strict) + ESLint + cargo clippy
pnpm build          # .msi + portable .exe, then prints sizes
```

## Layout

```
packages/engine     pure TypeScript budget engine (no DOM, no Tauri, no I/O)
packages/shared     types shared by engine and UI (Minor money, ISODate/Month)
apps/desktop        Tauri 2 app: React UI in src/, Rust in src-tauri/
docs/decisions      architecture decision records
```
