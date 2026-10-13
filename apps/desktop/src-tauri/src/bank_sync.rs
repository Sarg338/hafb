//! Optional bank sync through SimpleFIN Bridge (S8.6, ADR 0006): link with a setup token, unlink,
//! and fetch accounts and transactions. The only network code in HAFB.
//! - Nothing here runs until the user links SimpleFIN. Unlinked, HAFB makes no connections.
//! - Requests go over HTTPS only to the host the user's token names: no proxy, no redirects, no
//!   other host. Certificates are checked against the bundled Mozilla roots (webpki-roots), so
//!   Windows never fetches revocation lists on HAFB's behalf.
//! - The access URL SimpleFIN hands back is the only secret. It never contains a bank password. It
//!   lives in Windows Credential Manager ("Remember on this PC") or in memory for this run, never
//!   in the plan, prefs, logs, backups or error messages, and it never reaches the webview.
//! - Thin (CLAUDE.md §9): this returns SimpleFIN's JSON as it came; @hafb/store turns it into
//!   transactions.

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use hafb_store::error::{ErrorKind, Result, StoreError};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

/// Where Credential Manager keeps the access URL: one SimpleFIN link per Windows user on this PC.
const CREDENTIAL: &str = "HAFB SimpleFIN access";
/// The smoke suite's link goes under its own name, so a test never touches a real one.
const FIXTURE_CREDENTIAL: &str = "HAFB SimpleFIN access (smoke test)";
/// Bigger answers are refused (90 days of 25 banks is a few MB).
const MAX_BODY: u64 = 64 * 1024 * 1024;
/// The smoke suite points this at a saved SimpleFIN answer instead of going online.
const FIXTURE_ENV: &str = "HAFB_SIMPLEFIN_FIXTURE";
const FIXTURE_ACCESS: &str = "https://fixture:fixture@simplefin.invalid/simplefin";

/// The access URL kept for this run only, when the user didn't ask to remember it.
#[derive(Default)]
pub struct BankState {
    session: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BankStatus {
    linked: bool,
    /// Kept in Credential Manager (else for this run only).
    remembered: bool,
    /// The SimpleFIN server, to show the user which one they linked.
    host: Option<String>,
}

/// An access URL taken apart: the secret is only in `authorization`.
#[derive(Debug)]
struct Access {
    base: String,
    host: String,
    authorization: String,
}

fn bad(message: impl Into<String>) -> StoreError {
    StoreError::new(ErrorKind::Invalid, message)
}

fn net(message: impl Into<String>) -> StoreError {
    StoreError::new(ErrorKind::Io, message)
}

fn lock_err<T>(_: T) -> StoreError {
    StoreError::new(ErrorKind::Io, "Internal state lock was poisoned; restart the app.")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |at: usize| bytes.get(at).and_then(|&b| char::from(b).to_digit(16));
    while i < bytes.len() {
        let escaped = if bytes[i] == b'%' { hex(i + 1).zip(hex(i + 2)) } else { None };
        match escaped {
            Some((h, l)) => {
                out.push(u8::try_from(h * 16 + l).unwrap_or(b'?'));
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `https://` and what follows it, or None for any other scheme.
fn after_https(url: &str) -> Option<&str> {
    let (scheme, rest) = url.split_once("://")?;
    scheme.eq_ignore_ascii_case("https").then_some(rest)
}

fn valid_host(host: &str) -> bool {
    !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'))
}

/// `https://user:pass@host/path` → the base URL without credentials, and a Basic authorization.
fn parse_access(url: &str) -> std::result::Result<Access, String> {
    const NOT_ACCESS: &str = "SimpleFIN sent back something that isn't an access link.";
    let rest = after_https(url.trim()).ok_or(NOT_ACCESS)?;
    let (authority, path) = rest.find('/').map_or((rest, ""), |i| rest.split_at(i));
    let (userinfo, host) = authority.rsplit_once('@').ok_or(NOT_ACCESS)?;
    let (user, pass) = userinfo.split_once(':').ok_or(NOT_ACCESS)?;
    if user.is_empty() || !valid_host(host) || path.contains(['?', '#']) || path.chars().any(char::is_whitespace) {
        return Err(NOT_ACCESS.to_owned());
    }
    let credentials = format!("{}:{}", percent_decode(user), percent_decode(pass));
    Ok(Access {
        base: format!("https://{host}{}", path.trim_end_matches('/')),
        host: host.to_ascii_lowercase(),
        authorization: format!("Basic {}", STANDARD.encode(credentials)),
    })
}

/// A setup token is a base64 claim URL; it must be HTTPS and carry no credentials.
fn claim_url(token: &str) -> std::result::Result<String, String> {
    const NOT_TOKEN: &str = "That isn't a SimpleFIN setup token. Copy the whole token from SimpleFIN and paste it here.";
    let cleaned: String = token.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = STANDARD.decode(&cleaned).or_else(|_| URL_SAFE.decode(&cleaned)).map_err(|_| NOT_TOKEN)?;
    let url = String::from_utf8(bytes).map_err(|_| NOT_TOKEN)?;
    let rest = after_https(&url).ok_or(NOT_TOKEN)?;
    let authority = rest.split('/').next().unwrap_or_default();
    if authority.contains('@') || !valid_host(authority) || url.chars().any(char::is_whitespace) {
        return Err(NOT_TOKEN.to_owned());
    }
    Ok(url)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into()
}

fn read_body(mut response: ureq::http::Response<ureq::Body>, host: &str) -> Result<(u16, String)> {
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_string()
        .map_err(|e| net(format!("{host} sent an answer HAFB couldn't read ({e}).")))?;
    Ok((status, body))
}

fn unreachable(host: &str, e: &ureq::Error) -> StoreError {
    net(format!("Couldn't reach {host}. Check the internet connection and try again. ({e})"))
}

/// Trade a setup token for an access URL. A token works once.
fn claim(token: &str) -> Result<String> {
    let url = claim_url(token).map_err(bad)?;
    let host = after_https(&url).and_then(|r| r.split('/').next()).unwrap_or_default().to_ascii_lowercase();
    let response = agent().post(&url).send_empty().map_err(|e| unreachable(&host, &e))?;
    let (status, body) = read_body(response, &host)?;
    match status {
        200 => {
            parse_access(&body).map_err(net)?;
            Ok(body.trim().to_owned())
        }
        403 => Err(bad("SimpleFIN didn't accept that setup token. A token works only once: make a new one on SimpleFIN's site and paste it here.")),
        _ => Err(net(format!("{host} answered with an error (HTTP {status}). Try again later."))),
    }
}

/// GET /accounts. `start` (inclusive) and `end` (exclusive) are Unix times; pending transactions
/// are never asked for.
fn fetch(access: &str, start: Option<i64>, end: Option<i64>, balances_only: bool) -> Result<serde_json::Value> {
    let a = parse_access(access).map_err(net)?;
    let mut url = format!("{}/accounts?version=2", a.base);
    if let Some(s) = start {
        url.push_str(&format!("&start-date={s}"));
    }
    if let Some(e) = end {
        url.push_str(&format!("&end-date={e}"));
    }
    if balances_only {
        url.push_str("&balances-only=1");
    }
    let response = agent().get(&url).header("Authorization", &a.authorization).call().map_err(|e| unreachable(&a.host, &e))?;
    let (status, body) = read_body(response, &a.host)?;
    match status {
        200 => serde_json::from_str(&body).map_err(|_| net(format!("{} sent an answer HAFB couldn't read.", a.host))),
        402 => Err(net("SimpleFIN says the subscription needs paying. Renew it on SimpleFIN's site, then sync again.")),
        403 => Err(net("SimpleFIN refused HAFB's link. It may have been turned off on SimpleFIN's site. Unlink, then link again with a new setup token.")),
        _ => Err(net(format!("{} answered with an error (HTTP {status}). Try again later.", a.host))),
    }
}

fn fixture() -> Option<String> {
    std::env::var(FIXTURE_ENV).ok().filter(|v| !v.is_empty())
}

fn credential() -> &'static str {
    if fixture().is_some() { FIXTURE_CREDENTIAL } else { CREDENTIAL }
}

/// The access URL in use: this run's, else the one remembered on this PC.
fn current(state: &BankState) -> Result<Option<(String, bool)>> {
    if let Some(s) = state.session.lock().map_err(lock_err)?.clone() {
        return Ok(Some((s, false)));
    }
    Ok(crate::credentials::load_secret(credential()).map(|s| (s, true)))
}

fn status_of(current: Option<&(String, bool)>) -> BankStatus {
    match current {
        Some((access, remembered)) => BankStatus { linked: true, remembered: *remembered, host: parse_access(access).ok().map(|a| a.host) },
        None => BankStatus { linked: false, remembered: false, host: None },
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| net(format!("Bank sync stopped unexpectedly ({e}).")))?
}

#[tauri::command]
pub async fn bank_status(state: State<'_, BankState>) -> Result<BankStatus> {
    Ok(status_of(current(&state)?.as_ref()))
}

/// Claim `token` and keep the access URL: in Credential Manager when `remember`, else for this run.
#[tauri::command]
pub async fn bank_link(state: State<'_, BankState>, token: String, remember: bool) -> Result<BankStatus> {
    let access = if fixture().is_some() {
        claim_url(&token).map_err(bad)?;
        FIXTURE_ACCESS.to_owned()
    } else {
        blocking(move || claim(&token)).await?
    };
    let mut session = state.session.lock().map_err(lock_err)?;
    if remember {
        crate::credentials::save_secret(credential(), &access).map_err(net)?;
        *session = None;
    } else {
        crate::credentials::delete_secret(credential());
        *session = Some(access.clone());
    }
    Ok(status_of(Some(&(access, remember))))
}

/// Forget the access URL on this PC. (Revoking it is done on SimpleFIN's site.)
#[tauri::command]
pub async fn bank_unlink(state: State<'_, BankState>) -> Result<BankStatus> {
    *state.session.lock().map_err(lock_err)? = None;
    crate::credentials::delete_secret(credential());
    Ok(status_of(None))
}

/// SimpleFIN's accounts, with transactions posted from `start` up to (not including) `end` (Unix
/// times; no `end` = up to now) unless `balances_only`. Errors if SimpleFIN isn't linked on this PC.
#[tauri::command]
pub async fn bank_fetch(state: State<'_, BankState>, start: Option<i64>, end: Option<i64>, balances_only: bool) -> Result<serde_json::Value> {
    let Some((access, _)) = current(&state)? else {
        return Err(bad("SimpleFIN isn't linked on this PC. Link it in Preferences, under Bank sync."));
    };
    if let Some(path) = fixture() {
        let text = std::fs::read_to_string(path)?;
        return serde_json::from_str(&text).map_err(|e| bad(format!("The SimpleFIN fixture isn't JSON ({e}).")));
    }
    blocking(move || fetch(&access, start, end, balances_only)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_access_url_splits_into_a_bare_url_and_basic_auth() {
        let a = parse_access("https://Demo:s3cr%40t@Beta-Bridge.simplefin.org/simplefin/\n").unwrap();
        assert_eq!(a.base, "https://Beta-Bridge.simplefin.org/simplefin");
        assert_eq!(a.host, "beta-bridge.simplefin.org");
        assert_eq!(a.authorization, format!("Basic {}", STANDARD.encode("Demo:s3cr@t")));
        assert!(!a.base.contains("s3cr"), "the bare URL carries no secret");
    }

    #[test]
    fn anything_but_an_https_access_url_is_refused() {
        for url in [
            "http://user:pass@bridge.simplefin.org/simplefin",
            "https://bridge.simplefin.org/simplefin",
            "https://user@bridge.simplefin.org/simplefin",
            "https://user:pass@/simplefin",
            "https://user:pass@bad host/simplefin",
            "https://user:pass@bridge.simplefin.org/simplefin?x=1",
            "ftp://user:pass@bridge.simplefin.org/",
            "",
        ] {
            assert!(parse_access(url).is_err(), "{url}");
        }
    }

    #[test]
    fn errors_never_repeat_the_access_url() {
        let e = parse_access("http://user:topsecret@bridge.simplefin.org/simplefin").unwrap_err();
        assert!(!e.contains("topsecret"));
    }

    #[test]
    fn a_setup_token_decodes_to_its_claim_url() {
        // SimpleFIN's published demo token.
        let demo = "aHR0cHM6Ly9iZXRhLWJyaWRnZS5zaW1wbGVmaW4ub3JnL3NpbXBsZWZpbi9jbGFpbS9ERU1PLXYyLTkzN0UyOTA2NzRGNDAyOUI3RTJD";
        assert_eq!(claim_url(demo).unwrap(), "https://beta-bridge.simplefin.org/simplefin/claim/DEMO-v2-937E290674F4029B7E2C");
        // Pasted with stray spaces and a line break.
        assert!(claim_url(&format!(" {}\n{} ", &demo[..40], &demo[40..])).is_ok());
    }

    #[test]
    fn a_token_that_is_not_an_https_claim_url_is_refused() {
        for url in ["http://bridge.simplefin.org/claim/x", "https://user:pass@bridge.simplefin.org/claim/x", "https:///claim", "file:///C:/x"] {
            assert!(claim_url(&STANDARD.encode(url)).is_err(), "{url}");
        }
        assert!(claim_url("not base64 !!").is_err());
        assert!(claim_url("").is_err());
    }

    #[test]
    fn status_shows_the_host_and_never_the_secret() {
        let s = status_of(Some(&("https://u:p@bridge.simplefin.org/simplefin".to_owned(), true)));
        assert_eq!(s, BankStatus { linked: true, remembered: true, host: Some("bridge.simplefin.org".to_owned()) });
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("u:p"));
        assert_eq!(status_of(None), BankStatus { linked: false, remembered: false, host: None });
    }
}
