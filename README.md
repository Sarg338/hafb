# HAFB — Here's A Free Budget

[![CI](https://github.com/Sarg338/hafb/actions/workflows/ci.yml/badge.svg)](https://github.com/Sarg338/hafb/actions/workflows/ci.yml)

A free, open-source envelope-budgeting app for Windows. It does what the popular paid budgeting apps do, giving every dollar a job, without a subscription, an account or a server. Your budget is one SQLite file on your PC that you own. MIT licensed.

**Status: beta (0.9.0).** Everything is built; it's in testing before 1.0. Bug reports are welcome in [Issues](https://github.com/Sarg338/hafb/issues).

## Download

Get the installer (`.msi`) or the portable zip from [Releases](https://github.com/Sarg338/hafb/releases). HAFB needs Windows 10 22H2 or later, or Windows 11, on x64. [docs/install.md](docs/install.md) covers installing, upgrading, uninstalling (your data stays) and checking a download.

## What it does

- **Planning:** Ready to Assign, Assigned / Activity / Available, cash and credit overspending, moving money, and covering overspending from future months.
- **Targets:** weekly, monthly, yearly and custom. Also Auto-Assign, Focused Views, Plan Reset and Cost to Be Me.
- **Accounts:** checking, savings, credit cards with payment categories, loans with interest, escrow and a payoff planner, and tracking accounts.
- **The register:** splits, transfers, flags, photo attachments, scheduled transactions, bulk edits, search, reconciling, undo and redo.
- **Reports:** Spending Breakdown, Spending Trends, Net Worth, Income v Expense and Age of Money.
- **Getting data in:** import a plan exported from the leading paid budgeting app, to the cent ([docs/migrating.md](docs/migrating.md)), and import bank files (CSV, OFX, QFX, QIF).
- **Optional bank sync** through [SimpleFIN Bridge](https://www.simplefin.org/), a service you sign up for and pay yourself. HAFB never sees your bank password.
- **Windows:** keyboard shortcuts throughout, light, dark and high-contrast themes, text up to 200%, and WCAG 2.2 AA accessibility.

## Your data stays yours

- No account, no telemetry, no update checks and no ads. HAFB works with the network unplugged.
- The one exception is bank sync, which stays off until you link it. Then it talks only to SimpleFIN. [docs/privacy.md](docs/privacy.md) has the details and how it was checked.
- Each plan is a single file saved where you choose, and any SQLite tool can read it. Backups run every time you open a plan. A password can lock a plan with SQLCipher (AES-256).
- To use it on more than one PC, put the file in OneDrive, Dropbox or Syncthing.

## Docs

- [docs/user-guide.md](docs/user-guide.md): everything HAFB does.
- [docs/migrating.md](docs/migrating.md): bringing an existing plan across.
- [docs/shortcuts.md](docs/shortcuts.md): every keyboard shortcut.
- [docs/beta.md](docs/beta.md): for beta testers. What's new: [CHANGELOG.md](CHANGELOG.md).
- For contributors: [CLAUDE.md](CLAUDE.md) is the spec, [docs/roadmap.md](docs/roadmap.md) tracks progress, [docs/budget-math.md](docs/budget-math.md) has every budget rule with worked examples, and [docs/decisions](docs/decisions) holds the architecture decisions.

## Building from source

Every push is built and tested by [GitHub Actions](.github/workflows/ci.yml), and releases are built there too. To build it yourself, you need:

- Windows 10 22H2+ or Windows 11 (x64) with the WebView2 Evergreen runtime. It's preinstalled on Windows 11.
- Node.js ≥ 22.12 and pnpm 12 (`npm install -g pnpm@12.10.1`).
- Rust stable (MSVC) with clippy (`rustup component add clippy`), plus Visual Studio Build Tools with the C++ workload.
- For `pnpm build:arm64` only: `rustup target add aarch64-pc-windows-msvc` and Visual Studio's *MSVC ARM64 build tools* component.
- Strawberry Perl (`winget install StrawberryPerl.StrawberryPerl`). OpenSSL's build scripts need it, because SQLCipher (plan passwords) uses OpenSSL's ciphers (ADR 0010). The first Rust build compiles OpenSSL in about 9 minutes.

```
pnpm install
pnpm dev            # run the app with hot reload (Tauri + Vite)
pnpm test           # Vitest, all packages
pnpm test:engine    # engine only
pnpm test:rust      # Rust tests
pnpm lint           # tsc (strict) + ESLint + cargo clippy
pnpm build          # license notices, then .msi + portable .zip + SHA-256 checksums, then prints sizes
pnpm build:arm64    # the same for Windows on ARM
pnpm smoke          # end-to-end tests that drive the built app (after pnpm build)
pnpm version:set 0.9.1   # set the version everywhere (Cargo.toml, package.json, Cargo.lock)
```

Release builds go through `pnpm build`; a bare `cargo build --release` makes a dev-mode exe.

```
packages/engine     pure TypeScript budget engine (no DOM, no Tauri, no I/O)
packages/store      plan data, commands and undo, imports and exports
packages/shared     types shared by engine and UI (Minor money, ISODate/Month)
apps/desktop        Tauri 2 app: React UI in src/, Rust in src-tauri/
docs/decisions      architecture decision records
```

## Code signing policy

Windows releases are built from this repository by [GitHub Actions](.github/workflows/ci.yml) and signed through SignPath Foundation's free program for open-source projects. Until the first signed release, downloads are unsigned and Windows SmartScreen warns about them ([docs/install.md](docs/install.md)).

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- Committers and reviewers: [Sarg338](https://github.com/Sarg338)
- Approvers: [Sarg338](https://github.com/Sarg338)

Every signing request is approved by hand, and only builds made by this repository's workflow from a version tag are signed.

**Privacy:** this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. The only such request is optional bank sync, which the user turns on by linking their own SimpleFIN account; HAFB then talks only to SimpleFIN's server ([docs/privacy.md](docs/privacy.md)).

## License

MIT (see [LICENSE](LICENSE)). The third-party components HAFB is built with, and their licenses, are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
