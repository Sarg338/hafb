# Privacy statement

HAFB keeps your plan on your PC. It has no account, no server, no telemetry, no analytics, no crash
reporting and no update checks, and it works with the network cable unplugged. This page says
exactly what does and doesn't leave the PC, and how that was checked (roadmap S8.3, 2026-10-10).

## What HAFB itself sends: nothing

- **Your data stays in files you own.** A plan is one `.hafb` file where you saved it. Backups,
  the recent-plans list and settings live in `%LOCALAPPDATA%\app.hafb.desktop\`. Nothing is copied
  anywhere else unless you put the file in a synced folder yourself.
- **There is no network code in the app.**
  - The Rust side has no HTTP, TLS or socket libraries. `cargo tree` for the shipped app lists no
    `reqwest`, `hyper`, `ureq`, `rustls` or `native-tls`, and `tokio` is built without its `net`
    feature. OpenSSL is compiled in for one job: SQLCipher's ciphers for plan passwords (ADR 0010).
    Only its crypto library is linked; its TLS code is left out by the linker.
  - The interface's code (`dist/assets/index-*.js`) calls no network API: no `XMLHttpRequest`,
    `WebSocket`, `EventSource` or `sendBeacon`. Its one `fetch` is Vite's module preloader loading
    HAFB's own script files. The only web addresses in it are XML namespaces and React's
    error-message links, which are text, never requested.
- **The page can't reach the network even if it tried.** Its content security policy allows
  scripts, styles, images and fonts only from the app itself, and requests only to HAFB's
  in-process IPC. It also forbids plugins, `<base>` changes and form submissions.
- **The installer downloads nothing.** It doesn't fetch the WebView2 runtime
  (`webviewInstallMode: skip`); WebView2 is part of Windows 11 and up-to-date Windows 10.
- **Optional bank sync (planned, S8.6)** will be the one exception, off by default: when you turn
  it on, HAFB contacts only the SimpleFIN Bridge server you link (ADR 0006).

## Plan passwords (optional)

Plan Settings can lock a plan with a password (S8.3b, ADR 0010). The file is then encrypted with
SQLCipher 4 (AES-256), and so are its backups and copies, so other programs can't read it without the
password. It stays a standard format: DB Browser for SQLite's SQLCipher edition opens it with the
password, so you are never locked in to HAFB.

- **Nothing about the password leaves the PC.** It isn't stored in the plan, sent anywhere or
  recoverable. A forgotten password means the plan can't be opened.
- **"Remember on this PC"** keeps it in Windows Credential Manager, for your Windows account on this
  PC only (it doesn't roam to other PCs). Unticking it, changing it or removing the password updates
  or deletes that entry.

## What the WebView2 runtime does, and what HAFB does about it

HAFB draws its window with Microsoft Edge WebView2, a part of Windows. Out of the box, WebView2
contacts Microsoft on its own. HAFB creates WebView2 itself (`src-tauri/src/webview_env.rs`) to
switch off what can be switched off:

| WebView2 behavior | Out of the box | In HAFB |
|---|---|---|
| Experimentation and Configuration Service (`config.edge.skype.com`), at start | Fetches Microsoft's feature-flag configuration | **Blocked.** WebView2's own web requests go to a closed proxy on this PC (`127.0.0.1:9`) and fail there. |
| Component updates (`edge.microsoft.com`), about a minute in | Fetches Edge components (block lists, certificate data and so on) | **Blocked**, the same way. |
| SmartScreen (URL reputation checks) | On | **Off.** HAFB only shows its own pages. |
| Crash dumps from WebView2's processes | Windows may send them to Microsoft, depending on your Windows diagnostic-data setting | **Kept on this PC.** HAFB sets `IsCustomCrashReportingEnabled`, so Windows doesn't send them. |
| Microsoft-account single sign-on for web pages | Off | **Off** (set explicitly). |
| Microsoft-account profile lookup (`substrate.office.com`) | On PCs signed into a Microsoft account | **Not switchable** (see below). |

### The one connection HAFB can't stop

On a PC where Windows is signed in with a Microsoft account, WebView2's built-in Microsoft sign-in
library (OneAuth, through the Windows account broker) looks up that account's profile from Microsoft
365 (`substrate.office.com`). This happens once per launch, a few seconds in.

- It is WebView2 talking to Microsoft about your Windows account, which Windows already does.
- **No plan data is involved:** HAFB never calls it, and it runs in WebView2's own browser process.
- No supported WebView2 option or switch turns it off. Turning off the related Edge features and
  setting the single-sign-on option to off were both tried and had no effect.
- On a PC with a local Windows account, there is no Microsoft account to look up.
- Sarg chose to document it rather than keep fighting it (2026-10-10).

### Outside HAFB's control

These belong to Windows and follow your Windows settings, as they do for every program:

- **Windows Error Reporting:** if HAFB itself crashes, Windows may report it, depending on your
  diagnostic-data setting. HAFB contains no crash reporter.
- **WebView2 updates:** Microsoft Edge Update keeps the WebView2 runtime current for all apps.
- **Windows diagnostic data:** Windows' own diagnostic data about its components follows your
  Windows privacy settings.

## Evidence (2026-10-10, WebView2 154.0.4258.62, Windows 11, this PC)

1. **Before the fix:** the release app ran for 8 minutes, with WebView2 pointed at a logging proxy
   and its process tree polled for sockets. The proxy logged `config.edge.skype.com` twice at start
   and `edge.microsoft.com` once at about a minute. Polling also saw the browser process connect
   straight to `substrate.office.com`. `msedgewebview2.exe` had `oneauth.dll`,
   `MicrosoftAccountWAMExtension.dll` and WinHTTP loaded.
2. **After the fix, in WebView2's network log** (`--log-net-log`): the configuration requests go to
   `127.0.0.1:9` and fail. No other outside host appears.
3. **Windows' own firewall log, with administrator rights.** Filtering Platform connection auditing
   (Security events 5156/5157 record every connection Windows allows or blocks, with the program
   and process ID) was on while the MSI was installed, the installed app was used for 5 minutes,
   and the app was uninstalled.
   - The installer and uninstaller (`msiexec`) made **no connections**.
   - HAFB's processes made loopback connections only, except one HTTPS connection from WebView2's
     browser process to a Microsoft 365 address: the account lookup above.
   - The audit setting was put back to "No Auditing" afterwards.
   - The audit ran twice, the second time on the final build, which creates WebView2's environment
     itself. Same result both times: 13 app-related events, all loopback apart from that one
     lookup.
4. **On every release:** the smoke test "using the app makes no outside connection except WebView2's
   documented account lookup" uses the app for about 80 seconds while polling its process tree. It
   fails if `hafb.exe` or any WebView2 process other than the browser process connects outside the
   PC, or if there's more than that one lookup.

## Licenses

Everything HAFB ships is under licenses compatible with HAFB's MIT license:
- **Rust crates (228 for x64 and ARM64):** MIT and/or Apache-2.0, BSD-3-Clause, Zlib and
  Unicode-3.0. Five MPL-2.0 crates (`cssparser`, `selectors`, `dtoa-short`, `option-ext`,
  `cssparser-macros`) are used unmodified; their source is on crates.io.
- **Compiled in:** SQLCipher (BSD-3-Clause, Zetetic) with SQLite (public domain), OpenSSL's crypto
  library (Apache-2.0), and Microsoft's WebView2 loader (BSD-3-Clause, from the WebView2 SDK).
- **JavaScript packages (12):** React, TanStack, `@fluentui/svg-icons` (MIT) and `@tauri-apps/api`
  (MIT or Apache-2.0).

Their notices travel with the app (S8.4): `THIRD-PARTY-NOTICES.txt` is installed beside `hafb.exe`,
is in the portable zip, and shows in *Help → About HAFB → Show third-party licenses*.
`scripts/notices.mjs` writes it from the dependency trees on every `pnpm build` and fails on a
license outside its allowed list; the UI build fails if it bundles a package the file doesn't list.
