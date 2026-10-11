// In-app help (S7.5): short topics bundled with the app, so help works offline like everything else.
// YNAB's vocabulary throughout, so people coming from YNAB recognise every term.

export type HelpBlock = string | { list: readonly string[] };

export interface HelpTopic {
  id: string;
  title: string;
  blocks: readonly HelpBlock[];
  /** About HAFB: the dialog adds the version and the third-party licenses (S8.4). */
  about?: true;
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'start',
    title: 'Getting started',
    blocks: [
      'A plan gives every dollar a job before you spend it. You plan with the money you have today, not money you expect.',
      {
        list: [
          'Add your accounts with today’s balances. Cash and credit accounts are part of the plan; loans and tracking accounts are watched but not planned.',
          'Set up categories for the jobs your money does. Add categories from a template (plan menu) for a quick start.',
          'Assign the money in Ready to Assign to categories until it reaches zero.',
          'Record spending as it happens, or import a file from your bank.',
        ],
      },
      'The Get started list in the inspector ticks itself off as you go. Coming from YNAB? Import your export from the welcome screen or the plan menu and everything comes across to the cent.',
    ],
  },
  {
    id: 'rta',
    title: 'Ready to Assign',
    blocks: [
      'Ready to Assign is money that has arrived but doesn’t have a job yet. Income goes there when you categorize it to Inflow: Ready to Assign.',
      'Assigning moves money from Ready to Assign into a category. When it shows All Money Assigned, every dollar has a job. If it turns red, you assigned more than you have: take money back from a category to fix it.',
      'Click the amount for a breakdown of this month’s inflows, what you assigned, and what you assigned in future months.',
    ],
  },
  {
    id: 'categories',
    title: 'Categories and targets',
    blocks: [
      'Each category has Assigned (what you gave it this month), Activity (what you spent or received) and Available (what’s left). Available carries into next month.',
      'A target tells a category what it needs:',
      {
        list: [
          'Set aside another: assign the same amount every week, month or year, and let it build up.',
          'Refill up to: top the category back up to an amount each period.',
          'Have a balance of: save toward an amount, by a date or eventually.',
        ],
      },
      'Select a category to create or edit its target in the inspector. Auto-Assign there can fund every underfunded target at once.',
    ],
  },
  {
    id: 'overspending',
    title: 'Moving money and overspending',
    blocks: [
      'Plans change. Click a category’s Available amount to move money to or from another category, or back to Ready to Assign.',
      'A red Available means you spent more than you had. Cover it from another category the same way. Cash overspending left at month end comes out of next month’s Ready to Assign; overspending on a credit card becomes card debt.',
      'Recent Moves (above the plan) lists every move you made in the last 34 days.',
    ],
  },
  {
    id: 'cards',
    title: 'Credit cards',
    blocks: [
      'Every credit card has a payment category. When you spend on the card from a funded category, that money moves to the card’s payment category, ready to pay the bill.',
      'Paying the card is a transfer from your checking account to the card. Record Payment fills in what the payment category holds.',
      'If the payment category holds less than the card’s balance, the difference is debt you haven’t planned for yet. Assign to the payment category to pay it down.',
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts and transactions',
    blocks: [
      'Open an account in the sidebar to see its transactions. Add Transaction (Shift+N) starts a new row: Tab moves between fields, Enter saves, Escape cancels.',
      'Transfers between your accounts use the account as the payee. Splits divide one transaction across categories.',
      'Scheduled transactions sit at the top of the register and enter themselves on their date, ready for you to approve.',
    ],
  },
  {
    id: 'import',
    title: 'Importing from your bank',
    blocks: [
      'File Import in a register reads CSV, OFX/QFX and QIF files downloaded from your bank. Transactions already in your plan are skipped, and ones you entered by hand are matched.',
      'Imported transactions arrive unapproved: check them, then approve (A). Reject (Shift+R) removes one that shouldn’t be there, and it won’t come back.',
      'For a CSV, pick which column is which once; the mapping is remembered for that account.',
    ],
  },
  {
    id: 'reconcile',
    title: 'Reconciling',
    blocks: [
      'Reconcile (Shift+E) checks the account against your bank. Enter the balance your bank shows; if it matches your cleared balance, everything cleared is locked as reconciled.',
      'If it doesn’t match, look for missing or duplicated transactions first. An adjustment can make up the difference if you can’t find it.',
    ],
  },
  {
    id: 'reflect',
    title: 'Reflect',
    blocks: [
      'Reflect shows where your money went: Spending Breakdown, Spending Trends, Net Worth, Income v Expense and Age of Money.',
      'Choose dates, categories and accounts at the top. Click any figure to see its transactions. Export saves a CSV (or TSV) and charts as pictures.',
    ],
  },
  {
    id: 'data',
    title: 'Your data',
    blocks: [
      'Your plan is one file on your PC that you choose where to keep. HAFB never sends it anywhere and never needs an account or the internet.',
      'A backup is made every time you open a plan; Backups in the plan menu restores one. Save a copy makes a duplicate you can keep anywhere, and Export for YNAB writes YNAB’s own CSV files.',
      'Make a Fresh Start (plan menu) begins a new plan from today with your categories and targets, and keeps this one as an archive.',
    ],
  },
  {
    id: 'about',
    title: 'About HAFB',
    about: true,
    blocks: [
      'HAFB (Here’s A Free Budget) is free software under the MIT License. It has no accounts, no subscriptions and no ads, and it never connects to the internet.',
      'Uninstalling HAFB removes only the program. Your plans, backups and settings stay on this PC.',
      'HAFB is built with open-source software from other projects, each under its own license.',
    ],
  },
];
