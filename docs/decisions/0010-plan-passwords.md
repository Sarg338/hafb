# ADR 0010 — Optional plan passwords with SQLCipher 4

- **Status:** Accepted (2026-10-10), S8.3b. Added to the roadmap by Sarg the same day.
- **Context:** a plan is a plain SQLite file (CLAUDE.md §1), so any program that can read the file can read the budget: another app, someone with the PC, a cloud folder. Sarg asked for an optional password using a common algorithm, so the user can still open the file without HAFB, for example after uninstalling it. YNAB has nothing comparable: its data sits on YNAB's servers, encrypted with keys YNAB holds, and its export is plain CSV.

## Decision

- **Format: SQLCipher 4 with its default settings.** AES-256 on every page with an HMAC-SHA512 per page, and the key derived from the password with PBKDF2-HMAC-SHA512 at 256,000 iterations.
  - A locked plan is still one SQLite database, decrypted page by page in memory and never written to disk in the clear. Photos (BLOBs, ADR 0009) are encrypted with everything else.
  - **Without HAFB:** DB Browser for SQLite's official Windows package includes *DB Browser for SQLCipher*, which opens a locked plan with its password and its default settings. Zetetic's `sqlcipher` command-line tool works too; either can save a plain copy. Checked on 2026-10-10 with DB Browser 3.13.1's portable package (see Consequences). Older DB Browser releases (3.10 and earlier, SQLCipher 3) can't open SQLCipher 4 files.
  - A plan without a password is a plain SQLite file exactly as before. Nothing changes for anyone who doesn't set one.
- **Library:** rusqlite's `bundled-sqlcipher-vendored-openssl` feature in place of `bundled`. SQLCipher (BSD-3-Clause, Zetetic) is SQLite plus the codec, and its crypto comes from OpenSSL's `libcrypto` (Apache-2.0), built from source and linked statically.
  - No new direct dependency. OpenSSL is used for its ciphers only: SQLCipher never opens a socket, and the HTTP/TLS check in `docs/privacy.md` still holds (no `reqwest`, `hyper`, `rustls`; `libssl` is built but nothing links it).
  - **Building needs Strawberry Perl** (OpenSSL's build scripts need a Windows Perl; Git's MSYS Perl doesn't work). The first build compiles OpenSSL in about 9 minutes; later builds reuse it.
  - OpenSSL's own build always optimizes (checked: the debug and optimized-profile libraries are the same size), so debug builds derive keys at release speed with no profile override.
  - Cost: the installer grows (see Consequences); opening a locked plan spends about 175 ms deriving the key.
- **Compression: not offered.** Compressing hides nothing (anyone can decompress), and encrypted data doesn't compress.
- **Recognizing a locked file:** by its header, before SQLite or the integrity check see it (`lock::is_locked`): whole pages (a size that is a multiple of 512 bytes) without the "SQLite format 3" header. So a locked plan is never mistaken for a damaged one, and a wrong password never offers backup recovery (S8.2). A wrong password and a locked file with a damaged first page can't be told apart; both say the password isn't right.
- **Setting, changing and removing** (`Plan::set_password`): the open plan is exported with `sqlcipher_export` into a file beside it under the new password (or none), with `user_version` and `application_id` copied by hand because the export doesn't carry them. The new file is checked (opens, is a plan, passes `quick_check`) and renamed over the old one. A process killed at any point leaves the plan under one password or the other. It is a file operation, not an undoable command.
- **Backups follow the password** (Sarg's requirement): Plan Settings offers, on by default, to rewrite the plan's backups to match (`relock_backups`).
  - Each backup that opens with the old password, or is plain, is written as `*.hafb.partial` (which the list ignores), checked, and renamed over itself. So a killed process leaves each backup under one password or the other.
  - Backups that don't open (made under an even earlier password, or damaged) are listed, and the user can enter that earlier password to bring them along.
  - Setting a password locks plain backups; removing it unlocks them.
  - New backups (`VACUUM INTO`) and *Save a copy* are locked with the plan's password automatically; copies saved earlier aren't tracked.
- **Restore and recovery keep the plan's current password:** a backup under another password (or none) is rewritten under the current one. A backup under a different password needs that password, which the app asks for.
- **Fresh Start of a locked plan** creates the new plan locked with the same password, held in Rust, never sent to the webview.
- **"Remember on this PC"** keeps the password in Windows Credential Manager as a generic credential, `HAFB plan password: <full path>`, persisted for this PC only (it doesn't roam), and protected by Windows for the signed-in user (`src-tauri/src/credentials.rs`).
  - Keyed by path, so a copy of the plan elsewhere still asks.
  - It stores the password rather than SQLCipher's derived key, because the derived key depends on each file's salt and every backup has its own.
  - A remembered password that stops working (changed on another PC) asks again rather than reporting a wrong password.
  - Passwords are at most 256 characters, which keeps them inside Credential Manager's 2,560-byte limit.
- **In memory:** the open plan's password stays in the Rust process while the plan is open, for backups, restore and changing it. The webview sees it only as the user types it.

## Consequences

- **Measured on this PC (2026-10-10):**
  - **Key derivation:** opening a locked plan costs about 175 ms. At launch it runs in the preload, while WebView2 is still starting, so it doesn't show.
  - **20k-transaction plan, launch to usable, median of 7, "Remember" on:**

    | | Plain | Locked |
    |---|---|---|
    | This PC | 790 ms | 783 ms |
    | Emulated 2019 laptop (S8.1 CPU cap) | 1,385 ms | 1,423 ms |

    Both stay inside the 1.5 s budget.
  - **Size:** the installer grew from about 2.6 MB to 3.8 MB, and the app from about 5.0 MB to 7.6 MB. OpenSSL's crypto library accounts for most of it.
  - **DB Browser interop** (DB Browser for SQLite 3.13.1, official portable package, SQLCipher 4.6.1):
    - *DB Browser for SQLCipher* opened a locked plan with its password. Its dialog offered SQLCipher 4's defaults unchanged (4,096-byte pages, SHA512 for the key and the HMAC), and it showed all 22 tables with "Encrypted" in the status bar.
    - Its `sqlcipher.dll` read the plan row, accounts and transactions, and passed `quick_check`.
    - A wrong password or none gives "file is not a database".
- **A forgotten password can't be recovered.** The dialog says so before a password is set.
- **Doesn't protect against** malware running as the user while the plan is open. Device encryption (BitLocker) is the answer for a lost laptop; this is for the file itself: cloud folders, shared PCs, copies.
- **CLAUDE.md §1** "human-inspectable with any SQLite tool" now reads: any SQLite tool, or for a locked plan, a SQLCipher tool with the password.
- **Tests:**
  - `store/tests/passwords.rs`: lock, change and remove; backups and copies; re-locking with a backup under an older password; restore keeping the password; recovery of a damaged locked plan; a process killed mid-change, 4 rounds, plan and backups always whole.
  - A credential round-trip test.
  - A release-app smoke test: lock from Plan Settings, the wrong-password prompt, Remember, change with backups, remove.
  - The DB Browser check (Consequences above).
