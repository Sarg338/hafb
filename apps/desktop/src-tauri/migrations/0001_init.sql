-- 0001_init: schema v1 (CLAUDE.md §4, ADR 0002). Never edit after merge; add 0002_... instead.
--
-- Conventions:
--   * Every table is STRICT: money columns are INTEGER minor units and SQLite refuses anything else.
--   * Dates are 'YYYY-MM-DD', months 'YYYY-MM', timestamps ISO 8601 UTC ('YYYY-MM-DDTHH:MM:SS.sssZ').
--   * Booleans are INTEGER 0/1. Ids are UUIDv7 text generated outside the database.
--   * User-facing entities soft-delete with deleted_at. Plain values (assignments, notes) are hard rows.
--   * Ready to Assign is a real category row (id 'ready-to-assign') in the system Inflow group so every
--     category reference can be a foreign key. The engine sees it only as the READY_TO_ASSIGN constant.
--   * The runner applies each migration inside one transaction with foreign keys deferred, after a backup.

CREATE TABLE plan (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  name               TEXT    NOT NULL,
  currency_code      TEXT    NOT NULL CHECK (length(currency_code) = 3),
  currency_decimals  INTEGER NOT NULL CHECK (currency_decimals BETWEEN 0 AND 4),
  currency_symbol    TEXT    NOT NULL,
  symbol_placement   TEXT    NOT NULL CHECK (symbol_placement IN ('before', 'after', 'none')),
  -- How numbers look, as YNAB's sample: '123,456.78', '123.456,78', '123 456,78', "123'456.78", ...
  number_format      TEXT    NOT NULL,
  -- 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY', ...
  date_format        TEXT    NOT NULL,
  first_month        TEXT    CHECK (first_month IS NULL OR first_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  -- Cost to Be Me (§5.4): expected monthly income.
  expected_income    INTEGER,
  -- Set on the old plan by Fresh Start.
  archived_at        TEXT,
  created_at         TEXT    NOT NULL
) STRICT;

CREATE TABLE accounts (
  id                  TEXT    PRIMARY KEY,
  name                TEXT    NOT NULL,
  type                TEXT    NOT NULL CHECK (type IN (
                        'checking', 'savings', 'cash', 'creditCard', 'lineOfCredit',
                        'mortgage', 'autoLoan', 'studentLoan', 'personalLoan', 'medicalDebt', 'otherDebt',
                        'asset', 'liability')),
  on_budget           INTEGER NOT NULL CHECK (on_budget IN (0, 1)),
  closed              INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  starred             INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  note                TEXT,
  sort_order          INTEGER NOT NULL,
  last_reconciled_at  TEXT,
  -- Loan accounts only (§5.10). Rate in basis points; amounts in minor units.
  interest_rate_bps   INTEGER CHECK (interest_rate_bps IS NULL OR interest_rate_bps >= 0),
  minimum_payment     INTEGER,
  escrow              INTEGER,
  fees                INTEGER,
  original_principal  INTEGER,
  paired_category_id  TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  created_at          TEXT    NOT NULL,
  deleted_at          TEXT
) STRICT;

CREATE TABLE category_groups (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  hidden       INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  sort_order   INTEGER NOT NULL,
  -- NULL for user groups. CLAUDE.md §4 is_system, with the kind spelled out.
  system_kind  TEXT    UNIQUE CHECK (system_kind IS NULL OR system_kind IN ('inflow', 'creditCardPayments', 'hidden')),
  deleted_at   TEXT
) STRICT;

CREATE TABLE categories (
  id                      TEXT    PRIMARY KEY,
  group_id                TEXT    NOT NULL REFERENCES category_groups (id) DEFERRABLE INITIALLY DEFERRED,
  name                    TEXT    NOT NULL,
  hidden                  INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  note                    TEXT,
  sort_order              INTEGER NOT NULL,
  credit_card_account_id  TEXT    UNIQUE REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  deleted_at              TEXT
) STRICT;
CREATE INDEX categories_group ON categories (group_id);

-- System rows every plan has. The codec hides them from the engine (READY_TO_ASSIGN is a constant there).
INSERT INTO category_groups (id, name, hidden, sort_order, system_kind) VALUES ('inflow', 'Inflow', 0, -1, 'inflow');
INSERT INTO categories (id, group_id, name, hidden, sort_order) VALUES ('ready-to-assign', 'inflow', 'Ready to Assign', 0, 0);

CREATE TABLE targets (
  category_id          TEXT    PRIMARY KEY REFERENCES categories (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  amount               INTEGER NOT NULL CHECK (amount >= 0),
  cadence              TEXT    NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'yearly', 'custom')),
  -- weekly: 0 = Sunday ... 6 = Saturday.
  weekday              INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  -- monthly: 1..31, or 0 for "last day of the month".
  month_day            INTEGER CHECK (month_day IS NULL OR month_day BETWEEN 0 AND 31),
  -- yearly (first due date) and custom (due date; NULL = no date).
  due_date             TEXT,
  repeat_every_months  INTEGER CHECK (repeat_every_months IS NULL OR repeat_every_months > 0),
  behavior             TEXT    NOT NULL CHECK (behavior IN ('setAside', 'refill', 'haveBalance')),
  start_month          TEXT    NOT NULL,
  created_on           TEXT,
  -- JSON array of 'YYYY-MM'.
  snoozed_months       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(snoozed_months) AND json_type(snoozed_months) = 'array'),
  updated_at           TEXT,
  CHECK (cadence <> 'weekly'  OR weekday IS NOT NULL),
  CHECK (cadence <> 'monthly' OR month_day IS NOT NULL),
  CHECK (cadence <> 'yearly'  OR due_date IS NOT NULL)
) STRICT;

CREATE TABLE payees (
  id                      TEXT    PRIMARY KEY,
  name                    TEXT    NOT NULL,
  -- System-managed transfer payee ("Transfer : <account>").
  transfer_account_id     TEXT    UNIQUE REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  default_category_id     TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  default_category_fixed  INTEGER NOT NULL DEFAULT 0 CHECK (default_category_fixed IN (0, 1)),
  auto_categorize         INTEGER NOT NULL DEFAULT 1 CHECK (auto_categorize IN (0, 1)),
  note                    TEXT,
  deleted_at              TEXT
) STRICT;
CREATE INDEX payees_name ON payees (name COLLATE NOCASE);

CREATE TABLE payee_rename_rules (
  id               TEXT    PRIMARY KEY,
  match            TEXT    NOT NULL CHECK (match IN ('contains', 'startsWith', 'equals')),
  pattern          TEXT    NOT NULL CHECK (pattern <> ''),
  target_payee_id  TEXT    NOT NULL REFERENCES payees (id) DEFERRABLE INITIALLY DEFERRED,
  sort_order       INTEGER NOT NULL
) STRICT;

CREATE TABLE scheduled_transactions (
  id                   TEXT    PRIMARY KEY,
  account_id           TEXT    NOT NULL REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  next_date            TEXT    NOT NULL CHECK (next_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  frequency            TEXT    NOT NULL CHECK (frequency IN (
                         'never', 'daily', 'weekly', 'everyOtherWeek', 'twiceAMonth', 'every4Weeks', 'monthly',
                         'everyOtherMonth', 'every3Months', 'every4Months', 'twiceAYear', 'yearly', 'everyOtherYear')),
  anchor_day           INTEGER CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31),
  amount               INTEGER NOT NULL,
  payee_id             TEXT    REFERENCES payees (id) DEFERRABLE INITIALLY DEFERRED,
  category_id          TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  transfer_account_id  TEXT    REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  memo                 TEXT,
  flag                 TEXT    CHECK (flag IS NULL OR flag IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')),
  deleted_at           TEXT
) STRICT;

CREATE TABLE scheduled_subtransactions (
  id                        TEXT    PRIMARY KEY,
  scheduled_transaction_id  TEXT    NOT NULL REFERENCES scheduled_transactions (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  sort_order                INTEGER NOT NULL,
  amount                    INTEGER NOT NULL,
  payee_id                  TEXT    REFERENCES payees (id) DEFERRABLE INITIALLY DEFERRED,
  category_id               TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  transfer_account_id       TEXT    REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  memo                      TEXT
) STRICT;
CREATE INDEX scheduled_subtransactions_parent ON scheduled_subtransactions (scheduled_transaction_id);

CREATE TABLE transactions (
  id                        TEXT    PRIMARY KEY,
  account_id                TEXT    NOT NULL REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  date                      TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Signed minor units; negative = outflow. A split's amount is the sum of its subtransactions.
  amount                    INTEGER NOT NULL,
  payee_id                  TEXT    REFERENCES payees (id) DEFERRABLE INITIALLY DEFERRED,
  -- NULL = uncategorized, a split parent, an on-budget transfer, or an off-budget account.
  category_id               TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  memo                      TEXT,
  cleared                   TEXT    NOT NULL CHECK (cleared IN ('uncleared', 'cleared', 'reconciled')),
  approved                  INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0, 1)),
  flag                      TEXT    CHECK (flag IS NULL OR flag IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')),
  -- Transfers: the other account, and the other leg (a transaction or, for a split line, a subtransaction id).
  transfer_account_id       TEXT    REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  transfer_transaction_id   TEXT,
  scheduled_transaction_id  TEXT    REFERENCES scheduled_transactions (id) DEFERRABLE INITIALLY DEFERRED,
  is_starting_balance       INTEGER NOT NULL DEFAULT 0 CHECK (is_starting_balance IN (0, 1)),
  -- Bank file imports (Phase 7): FITID or synthetic id, plus what the bank originally said.
  import_id                 TEXT,
  imported_payee            TEXT,
  imported_memo             TEXT,
  created_at                TEXT    NOT NULL,
  deleted_at                TEXT
) STRICT;
CREATE INDEX transactions_account_date ON transactions (account_id, date);
CREATE INDEX transactions_date ON transactions (date);
CREATE INDEX transactions_category ON transactions (category_id);
CREATE INDEX transactions_payee ON transactions (payee_id);
CREATE UNIQUE INDEX transactions_import ON transactions (account_id, import_id) WHERE import_id IS NOT NULL;

CREATE TABLE subtransactions (
  id                       TEXT    PRIMARY KEY,
  transaction_id           TEXT    NOT NULL REFERENCES transactions (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  sort_order               INTEGER NOT NULL,
  amount                   INTEGER NOT NULL,
  payee_id                 TEXT    REFERENCES payees (id) DEFERRABLE INITIALLY DEFERRED,
  category_id              TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  transfer_account_id      TEXT    REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  transfer_transaction_id  TEXT,
  memo                     TEXT
) STRICT;
CREATE INDEX subtransactions_parent ON subtransactions (transaction_id);

-- The split invariant (CLAUDE.md §4): a parent with lines has no category of its own and its amount
-- equals the sum of its lines. Checked by the store at commit time, not by a trigger: a batch inserts
-- the parent and its lines in separate statements, and SQLite triggers cannot be deferred (ADR 0002).
CREATE VIEW split_violations AS
  SELECT t.id AS transaction_id, 'transactions' AS kind
    FROM transactions t JOIN subtransactions s ON s.transaction_id = t.id
   GROUP BY t.id
  HAVING t.amount <> SUM(s.amount) OR t.category_id IS NOT NULL
  UNION ALL
  SELECT t.id, 'scheduled_transactions'
    FROM scheduled_transactions t JOIN scheduled_subtransactions s ON s.scheduled_transaction_id = t.id
   GROUP BY t.id
  HAVING t.amount <> SUM(s.amount) OR t.category_id IS NOT NULL;

-- (month, category) -> assigned. The only user-entered plan number; activity and available are derived.
-- A zero assignment is no row.
CREATE TABLE month_categories (
  month        TEXT    NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  category_id  TEXT    NOT NULL REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  assigned     INTEGER NOT NULL CHECK (assigned <> 0),
  PRIMARY KEY (month, category_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE month_notes (
  month  TEXT PRIMARY KEY CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  note   TEXT NOT NULL
) STRICT;

-- Durable log of assignment changes: Recent Moves (34 days) and per-category assigned history.
CREATE TABLE money_moves (
  id                TEXT    PRIMARY KEY,
  created_at        TEXT    NOT NULL,
  month             TEXT    NOT NULL,
  -- NULL = Ready to Assign.
  from_category_id  TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  to_category_id    TEXT    REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  amount            INTEGER NOT NULL CHECK (amount > 0),
  kind              TEXT    NOT NULL CHECK (kind IN ('move', 'autoAssign', 'assign', 'categoryDeleted', 'planReset')),
  -- Moves made by one action (e.g. one auto-assign) share a group id.
  group_id          TEXT    NOT NULL
) STRICT;
CREATE INDEX money_moves_created ON money_moves (created_at);

CREATE TABLE focused_views (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  sort_order    INTEGER NOT NULL,
  -- NULL for a custom view; built-in views store only their order.
  builtin       TEXT    UNIQUE CHECK (builtin IS NULL OR builtin IN ('underfunded', 'overfunded', 'snoozed', 'moneyAvailable', 'overspent')),
  -- Custom views: JSON array of category ids.
  category_ids  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(category_ids) AND json_type(category_ids) = 'array')
) STRICT;

CREATE TABLE flag_names (
  color  TEXT PRIMARY KEY CHECK (color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')),
  name   TEXT NOT NULL
) STRICT;

CREATE TABLE reconciliations (
  id                         TEXT    PRIMARY KEY,
  account_id                 TEXT    NOT NULL REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  date                       TEXT    NOT NULL,
  statement_balance          INTEGER NOT NULL,
  adjustment_transaction_id  TEXT    REFERENCES transactions (id) DEFERRABLE INITIALLY DEFERRED,
  created_at                 TEXT    NOT NULL
) STRICT;

-- Imports the user rejected or deleted never come back (Phase 7).
CREATE TABLE rejected_imports (
  account_id  TEXT NOT NULL REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  import_id   TEXT NOT NULL,
  PRIMARY KEY (account_id, import_id)
) STRICT, WITHOUT ROWID;

-- Per-account bank-file settings (column mapping, date format, ...), as JSON (Phase 7).
CREATE TABLE import_profiles (
  account_id  TEXT PRIMARY KEY REFERENCES accounts (id) DEFERRABLE INITIALLY DEFERRED,
  profile     TEXT NOT NULL CHECK (json_valid(profile))
) STRICT;

-- Receipts and documents, inside the file so a plan stays one file. Not part of the snapshot load.
CREATE TABLE attachments (
  id              TEXT    PRIMARY KEY,
  transaction_id  TEXT    NOT NULL REFERENCES transactions (id) DEFERRABLE INITIALLY DEFERRED,
  file_name       TEXT    NOT NULL,
  mime_type       TEXT    NOT NULL,
  data            BLOB    NOT NULL,
  created_at      TEXT    NOT NULL
) STRICT;
CREATE INDEX attachments_transaction ON attachments (transaction_id);

-- Undo/redo log (S2.3): one row per applied command, kept for the current and recent sessions.
CREATE TABLE command_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  -- 'do' | 'undo' | 'redo'
  direction   TEXT    NOT NULL CHECK (direction IN ('do', 'undo', 'redo')),
  label       TEXT    NOT NULL,
  -- Row-level change sets as JSON (ADR 0002 §4).
  forward     TEXT    NOT NULL CHECK (json_valid(forward)),
  inverse     TEXT    NOT NULL CHECK (json_valid(inverse))
) STRICT;
CREATE INDEX command_log_session ON command_log (session_id, seq);
