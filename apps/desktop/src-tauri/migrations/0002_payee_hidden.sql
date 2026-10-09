-- 0002 (S5.5): payees can be hidden (YNAB's Manage Payees → Hide). Hidden payees aren't suggested
-- while typing and leave the manager's main list. Additive only: existing rows read as not hidden.
ALTER TABLE payees ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));
