// The Available states a pill and a progress bar can show (DESIGN.md "Money-State Colour").
/** `creditOverspent`: overspent on a credit card only (YNAB draws it yellow with a card icon; any cash overspending is red). */
export type MoneyState = 'funded' | 'underfunded' | 'overspent' | 'creditOverspent' | 'zero' | 'snoozed';
