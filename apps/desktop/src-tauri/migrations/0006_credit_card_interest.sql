-- YNAB's "Credit Card Interest" (rolling out Oct 2026; behind a flag in the app). Like Ready to
-- Assign, it is a system category row in the Inflow group so a transaction's category stays a
-- foreign key; the codec hides it and the engine sees the CREDIT_CARD_INTEREST constant
-- (budget-math §3.15). Only adds a row: no data changes.
INSERT INTO categories (id, group_id, name, hidden, sort_order) VALUES ('credit-card-interest', 'inflow', 'Credit Card Interest', 0, 1);
