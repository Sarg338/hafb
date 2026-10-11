// About HAFB (S8.4): the version, from apps/desktop/package.json via vite.config.ts. A Rust test
// keeps it equal to Cargo.toml's, which the installer uses; `pnpm version:set` changes both.
declare const __HAFB_VERSION__: string | undefined;

export const APP_VERSION = typeof __HAFB_VERSION__ === 'string' ? __HAFB_VERSION__ : 'dev';

/** The third-party license notices (THIRD-PARTY-NOTICES.txt), loaded only when someone asks. */
export async function loadNotices(): Promise<string> {
  return (await import('../../../../THIRD-PARTY-NOTICES.txt?raw')).default;
}
