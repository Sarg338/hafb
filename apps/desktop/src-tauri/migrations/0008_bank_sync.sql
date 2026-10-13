-- 0008 (S8.6, ADR 0006). Additive only.
--
-- Optional bank sync through SimpleFIN Bridge. Only non-secret metadata lives in the plan: which
-- SimpleFIN account an account is linked to, its name there, and when transactions last came in.
-- The access link itself is never stored in the plan (it stays in Windows Credential Manager).
--
-- accounts.bank_sync_id:   SimpleFIN's account id (unique within its connection). NULL = not linked.
-- accounts.bank_sync_name: what SimpleFIN calls it ("Regions Bank · Checking"), shown in Edit Account.
-- accounts.bank_synced_at: the last sync that brought transactions in (ISO timestamp, UTC); the
--                          next sync asks for transactions from 5 days before it.
ALTER TABLE accounts ADD COLUMN bank_sync_id TEXT;
ALTER TABLE accounts ADD COLUMN bank_sync_name TEXT;
ALTER TABLE accounts ADD COLUMN bank_synced_at TEXT;
-- One account per SimpleFIN account is enforced by the link command, not an index: an undo that
-- moves a link between two accounts writes both rows, and a unique index would refuse the first.
