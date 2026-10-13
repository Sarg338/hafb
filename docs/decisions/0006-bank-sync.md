# ADR 0006 — Optional bank sync through SimpleFIN Bridge

- **Status:** Accepted (2026-10-08) by Sarg. Built in S8.6, the very last item before v1.0 (moved from S6.7 by Sarg, 2026-10-09). **Built 2026-10-12** and tested against SimpleFIN's live demo; the check with Sarg's own banks waits on his sign-up.
- **Context:** CLAUDE.md §1 forbade all network calls, so bank sync was wontfix. Sarg asked for "live" transactions from his bank (Regions), with these conditions: completely optional, done through an existing API or framework, and the app never sees or stores bank credentials.

## Why SimpleFIN Bridge

- **How YNAB does it:** contracts with MX and Plaid, plus servers that hold every user's bank tokens, paid for out of the subscription. A free app with no server can't do that: the provider's secret keys can't ship inside a download, and someone would have to hold the tokens and pay for each connection.
- **What SimpleFIN Bridge offers:**
  - It holds the bank connection itself, through MX.
  - Each user pays SimpleFIN directly: $1.50/month or $15/year, covering up to 25 institutions and 25 apps.
  - Developers need no sign-up and pay nothing.
  - HAFB gets a read-only, revocable link that never contains the bank password.
- **Coverage:** Regions is on SimpleFIN's supported list (Bank, Mortgage, OnePass, Business Credit Card).
- **Rejected alternatives:**
  - **Plaid:** needs a client secret, so either a server or each user brings their own developer keys.
  - **Teller:** needs a client certificate per app, which has the same problem.
  - **The bank's Direct Connect (OFX):** HAFB would have to hold the bank password.
  - **Web Connect / QFX download:** free and credential-free, and already covered by S6.5.

## Decision

1. **Off by default, opt-in.** No network code runs until the user links SimpleFIN for a plan. With it off, the app makes zero connections; this is checked in S8.3.
2. **One host, Rust only.**
   - Requests go only to the SimpleFIN host named in the user's access URL, over HTTPS.
   - They're made from the Rust side; the webview's CSP stays closed to the network.
   - No other host is ever contacted: no logos, no telemetry.
3. **Linking:**
   - The user creates a setup token on SimpleFIN's site and pastes it into HAFB.
   - HAFB claims it once (a POST to the claim URL) and receives an access URL.
   - Bank usernames, passwords and MFA are only ever entered on SimpleFIN's site or the bank's.
4. **Storing the secret:**
   - The access URL is the only secret. It's stored in **Windows Credential Manager**, which encrypts it per Windows user.
   - It's never stored in the `.hafb` file, prefs, logs, backups or error messages.
   - Unlinking deletes it, and the user can also revoke it at SimpleFIN at any time.
   - **Resolved in S8.6:** linking offers **Remember on this PC**, ticked by default. Unticked, the access URL is kept in memory only and a new setup token is needed next time.
5. **What the plan file stores:** only non-secret metadata: which HAFB account maps to which SimpleFIN account id, and the time of the last sync that brought transactions in (migration 0008).
6. **When it syncs:**
   - **Automatically while the app is open:** on plan open (if the last sync is over an hour old), then about every 6 hours at a random minute. This stays far under SimpleFIN's limit of 24 requests a day, and SimpleFIN only refreshes from banks about once a day, so polling more often brings nothing new.
   - **Manually:** a *Sync now* button.
   - **Nothing runs while the app is closed.** The next launch catches up.
   - **Fetch window:** each fetch runs from the last sync minus 5 days of overlap (SimpleFIN's guidance), at most 89 days back, in requests of at most 45 days. The first sync reaches 89 days; transactions before the account's start are skipped, as for bank files. (SimpleFIN's live server warns past 45 days and caps at 90, 2026-10-12.)
7. **Same pipeline as file import (S6.5):**
   - Each transaction's import id is SimpleFIN's transaction id, namespaced.
   - Fetched transactions arrive **unapproved**.
   - They go through auto-match (§5.12), payee rename rules, RejectedImport, the reconciliation skip rule, and "cash inflows default to Ready to Assign".
   - Amounts are parsed from SimpleFIN's decimal strings straight to minor units, never through a float.
8. **Pending transactions are not imported** (they stay wontfix).
9. **Dependency:** S8.6 adds one Rust HTTP client with rustls. It's the only crate allowed to make network calls; its commit message states that, and it must not add telemetry.

## As built (S8.6, 2026-10-12)

- **One SimpleFIN link per Windows user on this PC**, not one per plan. One SimpleFIN subscription covers all of a user's plans, and a Fresh Start keeps syncing. The plan file records which SimpleFIN account each account syncs from, so a plan opened on another PC keeps its links and asks for SimpleFIN to be linked there.
- **Where it shows:**
  - Preferences → Bank sync: the token, Remember on this PC, Link and Unlink.
  - Edit Account → Bank sync: choose the SimpleFIN account. The list is fetched only when asked, to save SimpleFIN's daily requests.
  - **Sync Now** in a linked account's register (and in All Accounts when any account is linked).
  - A newly linked account syncs at once.
- **Undo:** a sync that brings transactions in is one undo step. A sync with nothing new changes nothing, so automatic syncs don't fill the undo list.
- **Mapping SimpleFIN's data:**
  - The import id is `sfin:` plus SimpleFIN's transaction id.
  - The date is `transacted_at` (the purchase) when SimpleFIN has it, else `posted`.
  - The payee is SimpleFIN Bridge's cleaned `payee` when present (an extension beyond protocol v2), else `description`. The memo is left empty.
  - Every `errlist` and `errors` message is shown to the user, as SimpleFIN asks.
  - An account in another currency than the plan's isn't synced, with a message.
- **HTTP client:** `ureq` 3.4.2 with rustls, ring and webpki-roots (Mozilla's root list, CDLA-Permissive-2.0).
  - It sets no proxy and follows no redirects, and makes no request of its own.
  - Every crate it added was over two weeks old. `zeroize` was pinned back to 1.8.2 for that reason.
- **Testing:** `HAFB_SIMPLEFIN_FIXTURE` makes the release app answer every fetch from a saved file, without going online and under its own Credential Manager name. The smoke suite uses it.
- **SimpleFIN's demo** (`beta-bridge.simplefin.org`) re-mints the ids of its newest transactions every minute or two. A later sync there brings those in again. Real banks keep their ids, and within one answer nothing is imported twice.

## Consequences

- CLAUDE.md §1 now allows exactly this exception; every other no-network rule stands.
- Users who don't link SimpleFIN see no difference. The only thing they'll notice is a *Link with SimpleFIN* option on the account screen.
- Data is roughly daily, not instant, and costs the user about $15/year, paid to SimpleFIN rather than to us.
- If SimpleFIN shuts down or changes its terms, file import (S6.5) remains the fallback.
