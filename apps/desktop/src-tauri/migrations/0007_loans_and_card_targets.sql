-- 0007 (S8.5). Additive only.
--
-- accounts.loan_charges_from: the first month HAFB may post a loan's interest, escrow and fees
-- ('YYYY-MM'). A loan imported from YNAB already holds the charges YNAB posted, so HAFB starts the
-- month after the export instead of back-posting every month of its history. NULL = the month
-- after the loan's first transaction, as before.
ALTER TABLE accounts ADD COLUMN loan_charges_from TEXT CHECK (loan_charges_from IS NULL OR loan_charges_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]');

-- targets.pay_off: YNAB's "Pay Off Balance by Date" on a credit card payment category (T-12). The
-- amount is whatever the card owes, so the row is a dated, non-repeating custom "Have a balance of"
-- with amount 0 and this flag set.
ALTER TABLE targets ADD COLUMN pay_off INTEGER NOT NULL DEFAULT 0 CHECK (pay_off IN (0, 1));
