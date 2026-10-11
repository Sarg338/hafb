//! "Remember on this PC" for plan passwords (S8.3b, ADR 0010): the password is kept in Windows
//! Credential Manager as a generic credential for this PC only (it doesn't roam with the Windows
//! account), protected by Windows for the signed-in user. One credential per plan file, keyed by
//! its full path, so a copy of the plan elsewhere (a synced folder, a USB stick) still asks.

use hafb_store::Password;
use std::path::Path;

/// Credential Manager holds at most 2,560 bytes per secret.
const MAX_BYTES: usize = 2560;

fn target(plan: &Path) -> String {
    let full = std::fs::canonicalize(plan).unwrap_or_else(|_| plan.to_path_buf());
    format!("HAFB plan password: {}", full.to_string_lossy().to_lowercase())
}

#[cfg(windows)]
mod imp {
    use super::MAX_BYTES;
    use hafb_store::Password;
    use windows_sys::Win32::Security::Credentials::{
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn save(target: &str, password: &Password) -> Result<(), String> {
        let mut blob = password.as_str().as_bytes().to_vec();
        if blob.len() > MAX_BYTES {
            return Err("That password is too long for Windows to remember.".to_owned());
        }
        let mut name = wide(target);
        let mut user = wide("HAFB");
        // SAFETY: every pointer refers to a live buffer for the duration of the call; CredWriteW
        // copies what it keeps.
        let ok = unsafe {
            let mut cred: CREDENTIALW = std::mem::zeroed();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = name.as_mut_ptr();
            cred.UserName = user.as_mut_ptr();
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            cred.CredentialBlobSize = u32::try_from(blob.len()).unwrap_or(0);
            cred.CredentialBlob = blob.as_mut_ptr();
            CredWriteW(&cred, 0)
        };
        blob.fill(0);
        if ok == 0 { Err(format!("Windows couldn't remember the password ({}).", std::io::Error::last_os_error())) } else { Ok(()) }
    }

    pub fn load(target: &str) -> Option<Password> {
        let name = wide(target);
        let mut found: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: CredReadW fills `found` with a buffer we free with CredFree; the blob is read
        // only within its stated size.
        unsafe {
            if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut found) == 0 || found.is_null() {
                return None;
            }
            let cred = &*found;
            let bytes = std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize).to_vec();
            CredFree(found.cast());
            String::from_utf8(bytes).ok().and_then(|s| Password::new(s).ok())
        }
    }

    pub fn delete(target: &str) {
        let name = wide(target);
        // SAFETY: a valid NUL-terminated name; a missing credential is not an error worth reporting.
        unsafe {
            CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use hafb_store::Password;
    pub fn save(_: &str, _: &Password) -> Result<(), String> {
        Err("Remembering passwords needs Windows.".to_owned())
    }
    pub fn load(_: &str) -> Option<Password> {
        None
    }
    pub fn delete(_: &str) {}
}

/// Remember `password` for the plan at `plan` on this PC.
pub fn remember(plan: &Path, password: &Password) -> Result<(), String> {
    imp::save(&target(plan), password)
}

/// The password remembered for `plan`, if any.
pub fn recall(plan: &Path) -> Option<Password> {
    imp::load(&target(plan))
}

/// Forget the password remembered for `plan` (nothing happens if there is none).
pub fn forget(plan: &Path) {
    imp::delete(&target(plan));
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_password_is_remembered_recalled_and_forgotten() {
        let plan = std::env::temp_dir().join(format!("hafb-cred-test-{}.hafb", std::process::id()));
        let pw = Password::new("pässword with ünicode").unwrap();
        forget(&plan);
        assert!(recall(&plan).is_none());
        remember(&plan, &pw).unwrap();
        assert_eq!(recall(&plan), Some(pw));
        forget(&plan);
        assert!(recall(&plan).is_none());
        // The longest password allowed, in the widest characters, still fits.
        let longest = Password::new("😀".repeat(hafb_store::lock::MAX_PASSWORD_CHARS)).unwrap();
        assert!(longest.as_str().len() <= MAX_BYTES);
        remember(&plan, &longest).unwrap();
        assert_eq!(recall(&plan), Some(longest));
        forget(&plan);
    }
}
