-- 0003 (S6.5): bank-file import and matching (CLAUDE.md §5.12). What the bank said (its date and
-- amount) is kept on imported and matched transactions, so a match can be undone (YNAB: Unmatch);
-- entered_amount is the amount the user had typed before a match replaced it with the bank's, and
-- matched_at marks a matched transaction. Additive only: existing rows read as never imported.
ALTER TABLE transactions ADD COLUMN imported_date TEXT CHECK (imported_date IS NULL OR imported_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE transactions ADD COLUMN imported_amount INTEGER;
ALTER TABLE transactions ADD COLUMN entered_amount INTEGER;
ALTER TABLE transactions ADD COLUMN matched_at TEXT;
-- Matching moves an import id from the imported row to the entered one in a single change, and
-- undo moves it back; a UNIQUE index would trip on the row order inside that change. The import
-- pipeline keeps one row per (account, import id) itself (packages/engine bankImport/plan.ts).
DROP INDEX transactions_import;
CREATE INDEX transactions_import ON transactions (account_id, import_id) WHERE import_id IS NOT NULL;
