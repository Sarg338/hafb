# ADR 0011 — Packaging: installer, upgrades, portable mode, license notices

- **Status:** Accepted (2026-10-11), S8.4.
- **Context:** before S8.4 the MSI's upgrade code was whatever Tauri derived from the product name, downgrades were allowed, the "portable" exe kept its data in AppData like the installed app, no license notices shipped, and `.hafb` files had no file type. The roadmap's bar: upgrading from the previous build keeps every file intact.

## Decision

- **MSI (WiX, per machine) stays the installer.** It needs an administrator once. A per-user installer (NSIS) was considered and not taken: the portable zip already serves people without admin rights. The installer never downloads anything (`webviewInstallMode: skip`).
- **Upgrade code pinned:** `bundle.windows.wix.upgradeCode` = `1c28ff98-a600-55b8-89eb-89a19e51ee75`, the value Tauri had been deriving from "HAFB" (`tauri inspect wix-upgrade-code`), so builds made before the pin upgrade cleanly. **It must never change**; a new code would install a second copy beside the first.
- **No System Restore point** (added 2026-10-12): Windows Installer makes one before every per-machine install unless the MSI sets `MSIFASTINSTALL`. It took 83 s of the first install on Sarg's PC, for an app that writes only its own folder, so `wix/no-restore-point.wxs` sets `MSIFASTINSTALL=1` (linked through `componentGroupRefs`). The install log now says *SRSetRestorePoint skipped*, and the files go in within a second of the administrator prompt.
- **Downgrades refused** (`allowDowngrades: false`): an older MSI over a newer install stops with *A newer version of HAFB is already installed* (exit 1603). Reinstalling the same version is allowed (`AllowSameVersionUpgrades`).
- **Versioning:** Cargo.toml's `[package] version` is the one source; `tauri.conf.json` has none, so Tauri and the MSI take Cargo's. `apps/desktop/package.json` carries the same number for About HAFB (Vite `define`). `pnpm version:set X.Y.Z` writes all of them and Cargo.lock; a Rust test fails if they disagree. MSI versions allow no pre-release tag and cap major and minor at 255, so betas are `0.9.x`, then `1.0.0`. S8.4 moved 0.0.1 to **0.9.0**.
- **Uninstall keeps data.** The MSI only ever writes `Program Files\HAFB`, shortcuts, the `.hafb` type and its own registry values. Plans, `%LOCALAPPDATA%\app.hafb.desktop` (backups, recent list, settings, WebView2 profile) and Credential Manager entries are never touched. `docs/install.md` says how to remove them by hand.
- **`.hafb` file type:** Tauri's `fileAssociations` → an advertised ProgId `HAFB.hafb` with *Open with HAFB* (`"%1"`). The app already opened a bare `.hafb` argument (`startup.rs`). Windows shows the app's icon for plan files; no separate document icon (no new look).
- **Portable mode:** a folder named `HAFB Data` beside the exe replaces the data folder for everything, including the WebView2 profile (`paths.rs`, decided once per run). `HAFB_DATA_DIR` still wins (tests). The portable zip is `HAFB\HAFB.exe`, `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt` and `HAFB Data\README.txt`, packed by `scripts/build-report.mjs` with Windows' own `tar.exe`. A marker folder, not a marker file or a flag, because it is also where the data goes: what you see is what it does. Remembered passwords stay per PC (Credential Manager), on purpose.
- **License notices:** `scripts/notices.mjs` writes `THIRD-PARTY-NOTICES.txt` (committed) on every `pnpm build`:
  - Rust crates the app links (normal dependencies of `hafb` for x64 and ARM64, from `cargo metadata --offline`); C code they compile in (SQLCipher/SQLite, OpenSSL, the WebView2 loader, whose BSD text is vendored in `scripts/notices/` from the WebView2 SDK package); JavaScript packages the UI bundles.
  - Each component's own license file where it ships one, else the standard text with its authors; identical texts printed once with the components that use them. Where a component offers a choice, the first allowed one in the list (MIT preferred).
  - Allowed: permissive licenses plus MPL-2.0 (five unmodified crates; the notice says their source is on crates.io). Anything else fails the build.
  - A Vite plugin fails the UI build if the bundle contains a package the file doesn't list.
  - Shipped beside the exe in the MSI and the zip, and in the app: *Help → About HAFB → Show third-party licenses* (loaded on demand as a separate chunk).
- **HAFB's own license:** `LICENSE` (MIT, "HAFB contributors") added at the repo root; it was claimed in README and Cargo.toml but missing.
- **ARM64 (nice-to-have):** `pnpm build:arm64` cross-compiles on an x64 PC (`--target aarch64-pc-windows-msvc`), OpenSSL included. It needs the Rust target and Visual Studio's *MSVC ARM64 build tools* component (README). The pinned upgrade code covers both architectures.
- **Unsigned builds:** SmartScreen behavior and how to get past it are documented in `docs/install.md`. *Updated 2026-10-17:* releases are built by GitHub Actions and signed through SignPath Foundation's free open-source program once it's approved (README, *Code signing policy*).

## Consequences

- **Tested on this PC (2026-10-11),** elevated `msiexec` steps, every file of the data folder and the plans hashed (SHA-256) before and after each:

  | Step | Result |
  |---|---|
  | Install 0.0.1 (the S8.3b build, derived upgrade code) | 1 entry |
  | Use it: open a plain plan and a locked one, *Remember on this PC* | backups, recent list, profile, credential |
  | Install 0.9.0 over it | 1 entry (0.9.0); 161 files unchanged; `.hafb` → HAFB; licenses installed |
  | Run 0.9.0 | recent list intact, locked plan opens with the remembered password, About says 0.9.0 |
  | Double-click equivalent (`Start-Process plan.hafb`) | `hafb.exe "…\Upgrade Plain.hafb"`, window "Upgrade Plain – HAFB"; the file shows HAFB's icon |
  | Install 0.9.1 over it | 1 entry (0.9.1); 167 files unchanged |
  | Install 0.9.0 over 0.9.1 | refused, exit 1603, *A newer version of HAFB is already installed*; files unchanged |
  | Uninstall | program, shortcuts and `.hafb` type gone; 167 files unchanged |
  | Reinstall 0.9.1, run it | everything as before, including the remembered password |

- **Portable:** a smoke test runs a copy of the exe beside `HAFB Data` without the test overrides; the recent list, backups and WebView2 profile land there and `%LOCALAPPDATA%\app.hafb.desktop` is unchanged.
- **Size:** the notices add about 230 KB of text, loaded only when shown; the MSI is 3.84 MB and the zip 3.56 MB.
- **ARM64:** built on this PC: a native ARM64 exe (PE32+, ARM64), MSI 3.68 MB, zip 3.40 MB. **Not run:** there's no ARM hardware here. It needs a run on a Windows on ARM PC before it's offered.
- Found on the way: `cmdkey` can't delete HAFB's credentials (it rejects the `HAFB plan password: \\?\…` target yet exits 0), so the S8.3b smoke test had been leaving them behind. `smoke/forget-credentials.ps1` deletes them through the Credential Manager API.
