-- 0004 (S7.1): Plan Settings can switch to a currency with other decimals. YNAB keeps every stored
-- amount and only changes how many decimals it shows ($370.01 shows as ¥370 and comes back on
-- switching back), so amounts stay in currency_decimals and display_decimals says what to show.
-- NULL = the same as currency_decimals. Additive only.
ALTER TABLE plan ADD COLUMN display_decimals INTEGER CHECK (display_decimals IS NULL OR display_decimals BETWEEN 0 AND 4);
