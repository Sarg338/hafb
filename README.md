# HAFB — Here's A Free Budget

A free, local-only, native Windows envelope-budgeting app. It aims for feature parity with YNAB without accounts, servers or subscriptions. Your budget is one SQLite file that you own. MIT licensed.

**Status: Phase 8 (release) in progress; version 0.9.0.** See [docs/roadmap.md](docs/roadmap.md) for progress, `docs/budget-math.md` for every rule with worked examples, [CLAUDE.md](CLAUDE.md) for the spec and [docs/decisions/0001-stack.md](docs/decisions/0001-stack.md) for the stack decision.

**Installing:** see [docs/install.md](docs/install.md) for the installer and portable versions, upgrading, uninstalling (your data stays) and the SmartScreen warning on unsigned builds.

## Requirements

- Windows 10 22H2+ or Windows 11 (x64) with the WebView2 Evergreen runtime. It's preinstalled on Windows 11.
- Node.js ≥ 22.12 and pnpm 12 (`npm install -g pnpm@12.10.1`).
- Rust stable (MSVC) with clippy (`rustup component add clippy`), plus Visual Studio Build Tools with the C++ workload.
- For `pnpm build:arm64` only: `rustup target add aarch64-pc-windows-msvc` and Visual Studio's *MSVC ARM64 build tools* component.
- Strawberry Perl (`winget install StrawberryPerl.StrawberryPerl`). OpenSSL's build scripts need it: SQLCipher, which locks plans with a password, uses OpenSSL's ciphers (ADR 0010). The first Rust build compiles OpenSSL in about 9 minutes.

## Commands

```
pnpm install
pnpm dev            # run the app with hot reload (Tauri + Vite)
pnpm test           # Vitest, all packages
pnpm test:engine    # engine only
pnpm lint           # tsc (strict) + ESLint + cargo clippy
pnpm build          # license notices, then .msi + portable .zip, then prints sizes
pnpm build:arm64    # the same for Windows on ARM (rustup target add aarch64-pc-windows-msvc)
pnpm notices        # regenerate THIRD-PARTY-NOTICES.txt only
pnpm version:set 0.9.1   # set the version everywhere (Cargo.toml, package.json, Cargo.lock)
```

Release builds go through `pnpm build`; a bare `cargo build --release` makes a dev-mode exe.

## Layout

```
packages/engine     pure TypeScript budget engine (no DOM, no Tauri, no I/O)
packages/shared     types shared by engine and UI (Minor money, ISODate/Month)
apps/desktop        Tauri 2 app: React UI in src/, Rust in src-tauri/
docs/decisions      architecture decision records
```

## License

MIT (see [LICENSE](LICENSE)). The third-party components HAFB is built with, and their licenses, are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
