# Installing HAFB

HAFB comes in two forms. Both are the same app.

| | Installer (`HAFB_<version>_x64_en-US.msi`) | Portable (`HAFB_<version>_x64_portable.zip`) |
|---|---|---|
| Where it goes | `C:\Program Files\HAFB`, for everyone on the PC | Any folder you unzip it to: a USB stick, a synced folder |
| Needs an administrator | Yes, once, to install (no System Restore point is made) | No |
| Start menu and desktop shortcuts | Yes | No |
| Double-click a `.hafb` plan to open it | Yes | No (use Open in HAFB) |
| Settings, recent plans, backups | `%LOCALAPPDATA%\app.hafb.desktop` | The `HAFB Data` folder beside `HAFB.exe` |

**Needs:** Windows 10 22H2 or later, or Windows 11, on x64. HAFB draws its window with Microsoft Edge WebView2, which is part of Windows 11 and arrives on Windows 10 with Microsoft Edge and Windows Update. The installer never downloads anything; if WebView2 is missing, install the *Evergreen Runtime* from Microsoft.

Plans are files you keep wherever you choose. Neither form puts them anywhere on its own.

**Where to get it:** the [Releases](https://github.com/Sarg338/hafb/releases) page. Each release is built from its version tag by the repository's GitHub Actions workflow (`.github/workflows/ci.yml`).

## "Windows protected your PC" (SmartScreen)

HAFB's downloads aren't code-signed, and Windows warns about unsigned programs it hasn't seen often:

- **Browser:** Edge may say the file "isn't commonly downloaded". Open the downloads list (Ctrl+J), choose the file's **…** menu, then **Keep**. If Edge asks again, choose **Show more**, then **Keep anyway**.
- **First run:** a blue window says *Microsoft Defender SmartScreen prevented an unrecognized app from starting*. Choose **More info**, check that the app is **HAFB.exe** or the HAFB `.msi`, then **Run anyway**. The publisher shows as *Unknown publisher*.
  - The installer shows this once, when you run it. Installed HAFB doesn't ask again.
  - The portable zip carries the download's *Mark of the Web*, so HAFB.exe asks on its first run. To avoid that, right-click the zip, choose **Properties**, tick **Unblock**, then unzip it.
- **Checking a download:** each release comes with `SHA256SUMS_<version>_<arch>.txt`, listing its files' SHA-256. In PowerShell, `Get-FileHash .\HAFB_0.9.0_x64_en-US.msi` should print the same value.

SmartScreen asks only because the file is unsigned and new. HAFB makes no network connections unless you link optional bank sync, and then only to SimpleFIN (`docs/privacy.md`).

## Upgrading

Run the newer installer. It replaces the installed version in place: one entry in *Installed apps*, the same shortcuts, and your plans, backups, settings and remembered passwords untouched. Close HAFB first.

- **An older installer won't install over a newer version.** It stops with *A newer version of HAFB is already installed.*
- **To go back to an older version**, uninstall, then install the older one; your files stay. A plan opened by a newer HAFB may have been upgraded to a format the older one can't read. It then says *This plan was saved by a newer version of the app*. The automatic backup from before the upgrade still opens.

For the portable version, replace `HAFB.exe` and keep the `HAFB Data` folder.

## Uninstalling

*Settings → Apps → Installed apps → HAFB → Uninstall* removes the program, its shortcuts and the `.hafb` file type. It leaves your data where it is, so reinstalling picks up where you left off:

- your plans, wherever you saved them;
- `%LOCALAPPDATA%\app.hafb.desktop`: backups, the recent plans list, settings, window position and the app's WebView2 profile;
- passwords saved with *Remember on this PC*: in *Control Panel → Credential Manager → Windows Credentials*, named `HAFB plan password: <plan path>`;
- a remembered bank sync link, named `HAFB SimpleFIN access` in the same place (Preferences → Bank sync → Unlink removes it).

To remove everything, delete that folder and those credentials too.

The portable version has no uninstaller: delete its folder. It leaves nothing elsewhere on the PC except remembered passwords and the bank sync link, which are in Credential Manager as above.

## Portable mode

When a folder named `HAFB Data` sits beside `HAFB.exe`, HAFB keeps everything there instead of in `%LOCALAPPDATA%`: settings, the recent plans list, backups and the WebView2 profile. The portable zip comes with that folder. Without it, the same `HAFB.exe` behaves like the installed app.

- **Remember on this PC** saves to that PC's Credential Manager, not the `HAFB Data` folder, so a locked plan asks for its password once on each PC. The password never travels with the files.
- The recent plans list stores full paths. If a USB stick gets a different drive letter, open the plan with **Open** and it's remembered again.
- Keep the plan on the same stick, or anywhere you like. HAFB doesn't move or copy it.

## Opening plans

With the installer, double-clicking a `.hafb` file opens it in HAFB, each plan in its own window. A plan already open in another HAFB window says so instead of opening twice. *Open with HAFB* is also in the file's right-click menu.

## ARM64

HAFB builds for Windows on ARM (`pnpm build:arm64`: `HAFB_<version>_arm64_en-US.msi` and `HAFB_<version>_arm64_portable.zip`). The build is a native ARM64 program but hasn't been run on ARM hardware yet. On an ARM PC the x64 build also runs, under Windows' emulation. Both installers share one upgrade code, so installing one replaces the other.
