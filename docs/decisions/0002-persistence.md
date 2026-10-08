# ADR 0002 — Persistence, commands & undo, plan files

- **Status:** Accepted (2026-10-08), Phase 2.
- **Deciders:** Claude (Sarg delegated: "You have full control").
- **Builds on:** ADR 0001 (rusqlite behind Tauri commands, no SQL in the webview).

## 1. Context

Phase 2 turns the Phase 1 engine into a real file: a `.hafb` SQLite file that can be created, opened, edited with undo, backed up, and filled from a YNAB export (CLAUDE.md §4, roadmap S2.1–S2.5).

Constraints carried over:

- One plan is one SQLite file the user owns and can inspect.
- Rust stays thin: no business logic (CLAUDE.md §9).
- The engine stays pure.
- Money is never a float, including on disk.

## 2. Decision summary

| Concern | Decision |
|---|---|
| Schema | `apps/desktop/src-tauri/migrations/0001_init.sql`: STRICT tables, CHECK constraints, deferred foreign keys. |
| Domain ↔ rows | `@hafb/store` codec (pure TS): one encoder and one validating decoder per record kind. |
| Rust store | Generic. It knows table names and primary keys, not entities. Two hot commands: `plan_load` (all tables, positional rows) and `plan_apply` (one SQLite transaction of upserts and deletes). |
| Undo | Record-level change sets with automatically computed inverses. Undo is "apply the inverse"; there are no hand-written inverse commands. |
| Writer lock | `PRAGMA locking_mode = EXCLUSIVE`, taken at open. A second window gets "already open". |
| Backups | `VACUUM INTO` a timestamped copy on every open (keep the last 10), plus a never-pruned copy before any migration. Stored under the app's local data folder, not next to the plan. |
| YNAB import | Pure TS: the zip reader (web-standard `DecompressionStream`) produces a `PlanData`, and the Rust store writes it. The same path serves `pnpm import:ynab` (through the `hafb-store` CLI) and the in-app importer. |

## 3. Schema conventions (0001_init.sql)

- **STRICT tables.** SQLite rejects a REAL in an INTEGER column, so a float can never reach a money column, even from a buggy writer. This is tested.
- **Formats:**
  - Dates are `YYYY-MM-DD` and months `YYYY-MM`, with GLOB checks.
  - Timestamps are ISO 8601 UTC strings supplied by the caller.
  - Booleans are 0/1 with CHECKs.
- **Enumerations** (account type, cleared, flag, frequency, target cadence and behavior, …) are TEXT with CHECK lists that match the engine's unions. They are spelled like the engine (`creditCard`, not `credit_card`), so the codec has no translation tables.
- **Ready to Assign is a real row.** The system group `inflow` and the category `ready-to-assign` are inserted by the migration. Every category reference is then a foreign key. The id equals the engine's `READY_TO_ASSIGN` constant, and the codec hides both rows from records.
- **Foreign keys are `DEFERRABLE INITIALLY DEFERRED`.** A batch can insert in any order (an account and its credit card payment category reference each other), and integrity is checked at COMMIT.
- **The split invariant is a view, not a trigger.** CLAUDE.md §4 asked for a DB trigger. SQLite triggers can't be deferred, though, and a batch writes the parent and its lines in separate statements, so a trigger would reject every valid split mid-batch. Instead:
  - The view `split_violations` lists parents whose amount ≠ Σ lines, or that carry a category of their own.
  - The store queries it before every COMMIT and rolls back on any row.
  - The invariant still lives in the schema, so any SQLite tool can run it.
- **Soft deletes** (`deleted_at`) apply to user-facing entities: accounts, groups, categories, payees, transactions, scheduled.
- **Hard rows:**
  - Values (assignments, notes, flag names) are plain rows.
  - A zero assignment is no row; `CHECK (assigned <> 0)` enforces it.
  - Split lines have no `deleted_at`: they live and die with their parent (ON DELETE CASCADE).
- **Not part of the snapshot load:**
  - `attachments` (BLOBs, Phase 4+ commands).
  - `command_log`.
- **`system_kind`** replaces CLAUDE.md's `is_system` boolean. It also says *which* system group (`inflow`, `creditCardPayments`, `hidden`) and is UNIQUE.
- **Migrations are append-only:**
  - `PRAGMA user_version` holds the applied count.
  - Each file runs in one transaction.
  - A file that is newer than the app is refused, never downgraded.

## 4. The wire contract (TS ↔ Rust)

Defined in `packages/store/src/codec.ts` and mirrored by `apps/desktop/src-tauri/src/store/`.

```ts
type SqlValue = string | number | null;                    // never REAL; booleans are 0/1
type Row = Record<string, SqlValue>;                       // column name → value
interface TableData { columns: string[]; rows: SqlValue[][] }  // positional: compact for 20k rows
type LoadedTables = Record<string, TableData>;             // every snapshot table, by name
interface RowChanges {
  upserts: { table: string; rows: Row[] }[];               // INSERT … ON CONFLICT(pk) DO UPDATE
  deletes: { table: string; keys: Row[] }[];               // DELETE WHERE pk = …; children cascade
}
```

### Rules the Rust store enforces

- **Tables:** a table must be in the snapshot set; `KEY_COLUMNS` in codec.ts is the canonical list.
- **Columns:** must exist; the store checks them against `PRAGMA table_info`, so a typo is an error, not a silent drop.
- **Values:**
  - A non-integer number is an error.
  - Integers outside ±2^53 are an error.
  - JSON booleans are accepted as 0/1.
- **Apply order:** all upserts in order, then all deletes, then the split check, then COMMIT. Deferred foreign keys are checked at COMMIT. Any failure rolls back the whole batch.
- **Load:** returns every snapshot table, including the `plan` row.

### The reference implementation

`packages/store/test/helpers/sqliteStore.ts` is a Node implementation of this contract on `node:sqlite`. The codec tests run the real migration SQL through it, which proves the codec and the schema agree. The Rust store must behave identically; its cargo tests cover the same cases.

## 5. Records, canonical form, snapshot

- **`PlanData`** mirrors one file, including soft-deleted rows.
  - Records extend the engine types (`AccountRecord extends Account`, …), so live records go to the engine without copying.
  - `budgetSnapshot(plan)` drops deleted rows and is memoized by object identity.
  - Every change produces a new `PlanData`, so the cache invalidates itself (S2.3 "engine result caching").
- **Canonical records:**
  - A NULL column is an omitted field.
  - A boolean equal to its column default is omitted (`closed: false`, `approved: true`, `autoCategorize: true`, …).
  - Decoding always yields canonical records. Commands must build canonical records; the property tests compare with `toEqual`, so a stray `closed: false` fails them.

## 6. Commands and undo (S2.3)

- **A command** is a pure function `(plan, ctx) → ChangeSet`.
  - `ctx` carries `now`, `today` and `newId`, so the store package stays pure.
  - A `ChangeSet` is record-level: `put` (records by kind), `remove` (keys by kind), and optionally `settings`.
- **`applyChanges(plan, changes)` returns three things:**
  - The new plan.
  - The **inverse** change set: the prior record for every overwritten or removed key, and a removal for every new key.
  - The **row changes** for the store, including split lines dropped by an edit.
- **Undo** applies the inverse; redo re-applies the forward set.
  - One user action (an auto-assign across 40 categories, a transfer and its pair) is one change set, so it is one undo step.
  - Inverses are computed, never hand-written, so "any sequence of commands followed by full undo restores the starting plan" holds by construction. A property test checks it.
- **Persistence:** every do, undo and redo is written with its row changes in the same SQLite transaction as a `command_log` row (session id, label, forward and inverse). The undo stack itself is per session and does not survive a restart, like YNAB's.
- **Undoing a creation hard-deletes the row** rather than soft-deleting it. The file then returns to exactly its prior state. A user deletion is a soft delete.
- **Assignment changes** also write `money_moves` rows (Recent Moves, CLAUDE.md §4) in the same change set.

## 7. Plan files (S2.5)

- **Create:**
  - New file (refuses to overwrite), migrate, write the `plan` row and the starter rows.
  - Fresh Start and import use the same path with a full `PlanData`.
- **Open:**
  - Refuse a file whose `user_version` is newer than the app.
  - If it's older, copy it to `before-migration-v<from>-<timestamp>.hafb` (never pruned), then migrate.
  - Take the exclusive lock.
  - Make the on-open backup (keep the last 10).
  - Add the file to the recent list.
- **WAL with exclusive locking:** no `-shm` file. A crash leaves at most a `-wal` file that SQLite replays on the next open.
- **Backups folder:** `%LOCALAPPDATA%\<app identifier>\backups\<plan stem>-<8 hex of the path hash>\`.
  - **Why not next to the plan:** plans often live in OneDrive or Syncthing folders, and syncing a new 5 MB copy on every open is waste and a source of sync conflicts.
  - **Settings, Phase 8:** "Export backup" and a configurable backup folder.
- **Restore:**
  - Back up the current file.
  - Close it.
  - Copy the backup over it.
  - Reopen.
- **Save a copy:** `VACUUM INTO` the chosen path.
- **Recent plans:** `recent.json` in the app's local data folder (paths only, at most 10).
- **File dialogs** use the `rfd` crate directly: native Windows `IFileDialog`, audited, no network. Choosing it over `tauri-plugin-dialog`:
  - The plugin wraps the same crate and adds a JS permission surface we don't need.
  - The webview never chooses arbitrary paths. It asks Rust to show a dialog and gets back the path the user picked.

## 8. YNAB import (S2.4)

- **Reading the export:**
  - `readZip(bytes)` reads stored and deflate entries with `DecompressionStream('deflate-raw')`, which is built into Node 22 and WebView2. No zip dependency.
  - The engine parses `Plan.csv` and `Register.csv` (Phase 1).
- **Building the plan:** `importYnabExport(...)` builds a full `PlanData`:
  - UUIDv7 ids.
  - Payees, including transfer and "Starting Balance" payees.
  - Transfer leg pairing.
  - Flags, cleared state and memos.
  - System groups.
  - Register rows after "today" become one-off scheduled transactions, because YNAB's export doesn't say how they repeat.
  - An import report that lists warnings and the targets to re-enter (YNAB doesn't export targets).
- **`pnpm import:ynab <zip> <out.hafb>`:** a Node script that pipes `encodePlan(plan)` into `hafb-store create` (a Rust CLI binary in the desktop crate). The migration runner and writer exist only once, in Rust.
- **Golden check:** importing the public sample and Sarg's trial export reproduces the Phase 1 golden numbers after a round trip through SQLite.

## 9. Consequences

- Adding a column is a migration, a codec change, and a fixture field. The codec round-trip test fails until all three agree.
- The Rust store stays about the same size as the schema grows, because it is generic.
- The positional load format is about half the size of keyed JSON for transactions. If 20k-transaction loads miss the 300 ms budget on Sarg's PC, the next step is a binary format (MessagePack) behind the same `LoadedTables` type.

## 10. Amendments from the build (2026-10-08)

- **Store layout:** the generic store is its own crate, `apps/desktop/src-tauri/store` (`hafb-store`), with no Tauri dependency, plus the `hafb-store` CLI. A binary inside the app crate would be picked up by Tauri's bundler and shipped in the MSI.
- **File identity:** migration 1 sets `PRAGMA application_id` to "HAFB". Open checks it first and refuses any other SQLite file as `NotAPlan`, leaving it untouched.
- **Durability:** `synchronous = FULL`. Every commit survives a power loss.
- **Upserts carry whole rows.** SQLite checks NOT NULL before it reaches ON CONFLICT. Each upsert row includes every key column, and each delete key is exactly the key columns.
- **Unique columns in one batch:** upserts run before deletes. A change set must not remove one row and add another with the same unique value (`credit_card_account_id`, a payee's `transfer_account_id`, `system_kind`, `builtin`, an import id) in the same batch; no command does.
- **Collection order:** collections are kept in key order, so undo restores a plan exactly. With UUIDv7 keys that is entry order, which the engine uses to break ties. After a load the app calls `normalizePlan(decodePlan(tables))`.
- **Ordered ids:** imports and the app use `uuidv7Generator`, which keeps ids made in the same millisecond in creation order.
- **Negative zero:** `minor(-0)` is 0, so a record never differs from what SQLite reads back.
- **Backups:**
  - Stamps are UTC: `open-20261008-123456-789Z.hafb`.
  - `open-` and `restore-` copies keep the newest 10 each; `before-migration-` copies are never pruned.
  - `plan_restore` only accepts a file from this plan's backup folder.
- **Command behaviour choices** (S2.3; revisit against YNAB in Phase 4):
  - Deleting a category moves every month's assigned money to the replacement, so Ready to Assign doesn't change.
  - A split-line transfer's other leg changes only through its split.
  - New transactions are cleared by default only in `cash`-type accounts. Starting balances are always cleared.
  - Closing an account requires a zero balance.
- **Scripts** run on Node 22 with `--experimental-strip-types` (no build step). Store sources use only erasable TypeScript syntax: no enums or parameter properties.
